// One place for reading something off the web, so every source reports the same failures the same
// way — and so a browser's deliberately vague CORS error becomes a sentence you can act on.

export class FeedError extends Error {
  constructor(public kind: "blocked" | "unreachable" | "status" | "shape", message: string) { super(message); }
}

export async function getText(url: string, token?: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined, redirect: "follow" });
  } catch {
    throw new FeedError("blocked", "Couldn't read it. The app has to allow other sites to read this address (an access-control-allow-origin header), or be reachable from this device.");
  }
  if (!res.ok) throw new FeedError("status", res.status === 401 || res.status === 403 ? "The app refused the token." : `The app answered ${res.status}.`);
  return res.text();
}
