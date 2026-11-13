import { useSyncExternalStore } from "react";

// Google sign-in that runs entirely in the browser (Google Identity Services, token model).
// There is no server, so there is no refresh token: Google hands out an access token that lasts
// about an hour, and Cadence asks for a new one when it runs out. Because a browser only allows
// Google's small window after a tap, Cadence asks on your next tap ("Resume sync").
// The client ID is public by design. Nothing secret is stored.

export const SCOPES = {
  base: ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"],
  tasks: ["https://www.googleapis.com/auth/tasks"],
  calendar: ["https://www.googleapis.com/auth/calendar.app.created"],
  calendarRead: ["https://www.googleapis.com/auth/calendar.events.readonly", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"],
} as const;
export type ScopeSet = keyof typeof SCOPES;

const LS = { client: "cadence:g:client", account: "cadence:g:account", token: "cadence:g:token", wanted: "cadence:g:wanted" };

export function clientId(): string {
  try { return localStorage.getItem(LS.client) || import.meta.env.VITE_GOOGLE_CLIENT_ID || ""; } catch { return import.meta.env.VITE_GOOGLE_CLIENT_ID || ""; }
}
export function setClientId(id: string) { try { if (id) localStorage.setItem(LS.client, id.trim()); else localStorage.removeItem(LS.client); } catch {} emit(); }

interface Token { access: string; exp: number; scopes: string[] }
export interface Account { email: string; name: string; picture: string }

interface State { account: Account | null; token: Token | null; wanted: ScopeSet[]; busy: boolean; error: string | null }
let state: State = load();
const subs = new Set<() => void>();
function emit() { state = { ...state }; subs.forEach(f => f()); }

function load(): State {
  const read = <T>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) ?? "null"); } catch { return null; } };
  const token = read<Token>(LS.token);
  return { account: read<Account>(LS.account), token: token && token.exp > Date.now() + 60_000 ? token : null, wanted: read<ScopeSet[]>(LS.wanted) ?? ["base"], busy: false, error: null };
}
function save() {
  try {
    if (state.account) localStorage.setItem(LS.account, JSON.stringify(state.account)); else localStorage.removeItem(LS.account);
    if (state.token) localStorage.setItem(LS.token, JSON.stringify(state.token)); else localStorage.removeItem(LS.token);
    localStorage.setItem(LS.wanted, JSON.stringify(state.wanted));
  } catch {}
}

export const googleState = () => state;
export function useGoogle() { return useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => state); }
export const isConnected = () => !!state.account;
export const hasToken = () => !!state.token && state.token.exp > Date.now() + 30_000;
export function hasScope(set: ScopeSet): boolean { return !!state.token && SCOPES[set].every(s => s.startsWith("http") ? state.token!.scopes.includes(s) : true); }
export const wants = (set: ScopeSet) => state.wanted.includes(set);

// ── Google Identity Services ───────────────────────────────────────────────
type TokenResponse = { access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
interface TokenClient { requestAccessToken(o?: { prompt?: string; scope?: string; login_hint?: string; include_granted_scopes?: boolean }): void }
declare global {
  interface Window { google?: { accounts: { oauth2: { initTokenClient(c: object): TokenClient; revoke(token: string, cb?: () => void): void } } } }
}

let gisLoading: Promise<void> | null = null;
export function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoading) {
    gisLoading = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => res();
      s.onerror = () => { gisLoading = null; rej(new Error("Couldn't load Google sign-in. Check your connection.")); };
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

let pending: Promise<boolean> | null = null;
/**
 * Asks Google for a token. Call it from a tap or click: browsers block Google's window otherwise.
 * `add` asks for extra permissions (Google Tasks, Calendar) on top of what was granted before.
 */
export function connect(opts: { add?: ScopeSet[]; prompt?: "" | "consent" | "select_account" } = {}): Promise<boolean> {
  if (pending) return pending;
  const id = clientId();
  if (!id) { state.error = "Google isn't set up for this copy of Cadence yet. Add a Google client ID in Settings → Google."; emit(); return Promise.resolve(false); }
  const wanted = [...new Set<ScopeSet>(["base", ...state.wanted, ...(opts.add ?? [])])];
  const scope = wanted.flatMap(w => SCOPES[w]).join(" ");
  state.busy = true; state.error = null; emit();
  pending = loadGis().then(() => new Promise<boolean>(resolve => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: id,
      scope,
      include_granted_scopes: true,
      callback: async (r: TokenResponse) => {
        if (!r.access_token) { state.error = r.error_description || r.error || "Google sign-in was cancelled."; state.busy = false; emit(); resolve(false); return; }
        const granted = (r.scope ?? "").split(" ");
        state.token = { access: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000, scopes: granted };
        // Only keep the extras Google actually granted (people can untick boxes).
        state.wanted = wanted.filter(w => w === "base" || SCOPES[w].every(s => granted.includes(s)));
        if (!state.account || opts.prompt === "select_account") {
          try {
            const u = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { authorization: `Bearer ${r.access_token}` } }).then(x => x.json());
            state.account = { email: u.email ?? "", name: u.name ?? "", picture: u.picture ?? "" };
          } catch { state.account = state.account ?? { email: "", name: "", picture: "" }; }
        }
        state.busy = false; save(); emit(); resolve(true);
      },
      error_callback: (e: { type?: string; message?: string }) => {
        state.busy = false;
        state.error = e.type === "popup_closed" ? null : e.type === "popup_failed_to_open" ? "Your browser blocked Google's window. Allow pop-ups for this site and try again." : (e.message ?? "Google sign-in didn't finish.");
        emit(); resolve(false);
      },
    });
    client.requestAccessToken({ prompt: opts.prompt ?? (state.account ? "" : "consent"), ...(state.account?.email ? { login_hint: state.account.email } : {}) });
  })).catch(e => { state.busy = false; state.error = (e as Error).message; emit(); return false; }).finally(() => { pending = null; });
  return pending;
}

export function dropScope(set: ScopeSet) { state.wanted = state.wanted.filter(w => w !== set); save(); emit(); }

export function signOut(revoke = false) {
  const t = state.token?.access;
  if (revoke && t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t);
  state = { account: null, token: null, wanted: ["base"], busy: false, error: null };
  save(); emit();
}

export class AuthNeeded extends Error { constructor() { super("auth"); } }

/** fetch with the Google token. Throws AuthNeeded when there's no valid token (the app then shows "Resume sync"). */
export async function gfetch(url: string, init: RequestInit = {}, retries = 2): Promise<Response> {
  if (!hasToken()) { if (state.token) { state.token = null; save(); emit(); } throw new AuthNeeded(); }
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${state.token!.access}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status === 401) { state.token = null; save(); emit(); throw new AuthNeeded(); }
  if ((res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimit|userRateLimit/i.test(await res.clone().text()))) && retries > 0) {
    await new Promise(r => setTimeout(r, 1200 * (3 - retries)));
    return gfetch(url, init, retries - 1);
  }
  return res;
}

export async function gjson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await gfetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GoogleError(res.status, body.slice(0, 400));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
export class GoogleError extends Error { constructor(public status: number, public body: string) { super(`Google ${status}: ${body}`); } }

/** Ask again after the next tap, once, when sync needs a fresh token. */
let armed = false;
export function resumeOnNextTap(onDone: () => void) {
  if (armed || !state.account || hasToken()) return;
  armed = true;
  const handler = () => {
    window.removeEventListener("pointerup", handler, true);
    armed = false;
    if (!navigator.onLine || hasToken()) return;
    void connect().then(ok => ok && onDone());
  };
  window.addEventListener("pointerup", handler, true);
}
