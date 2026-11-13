import { useSyncExternalStore } from "react";
import type { Task } from "./model";

// Small app-wide UI state: the quick-add box and the command palette.

interface UI { quickAdd: Partial<Task> | null; palette: boolean; shortcuts: boolean }
let ui: UI = { quickAdd: null, palette: false, shortcuts: false };
const subs = new Set<() => void>();
const set = (p: Partial<UI>) => { ui = { ...ui, ...p }; subs.forEach(f => f()); };
export const useUI = () => useSyncExternalStore(cb => { subs.add(cb); return () => subs.delete(cb); }, () => ui);
export const openQuickAdd = (defaults: Partial<Task> = {}) => set({ quickAdd: defaults });
export const closeQuickAdd = () => set({ quickAdd: null });
export const openPalette = () => set({ palette: true });
export const closePalette = () => set({ palette: false });
export const showShortcuts = (v: boolean) => set({ shortcuts: v });
