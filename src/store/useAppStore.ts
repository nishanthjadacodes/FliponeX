import { create } from 'zustand';
import {
  getUser,
  storeUser,
  getUserMode,
  setUserMode,
  type UserMode,
} from '../utils/storage';
import type { User } from '../types';

// ─── App store ──────────────────────────────────────────────────────
// Zustand holds the small amount of SHARED CLIENT state — the logged-in
// user, the app mode, the language. It is the reactive in-memory layer;
// AsyncStorage (via the existing utils/storage helpers) remains the
// persistence layer. Every mutating action writes through to
// AsyncStorage, so screens NOT yet migrated — which still call
// getUser() directly — keep seeing consistent data.
//
// Server data (bookings, services, profile from the API) does NOT
// belong here — that's TanStack Query's job. This store is only for
// client state that several screens need to share.
//
// Usage:
//   const user = useAppStore((s) => s.user);          // reactive read
//   useAppStore.getState().patchUser({ name: 'New' }); // imperative
//
// Selectors keep re-renders tight — a component reading only `mode`
// won't re-render when `user` changes.

type AppUser = (User | Record<string, unknown>) & {
  id?: string | number;
  name?: string;
  email?: string;
  mobile?: string;
  profile_pic?: string | null;
};

interface AppState {
  // ─── State ───
  user: AppUser | null;
  mode: UserMode | null;
  language: string;
  // True once the initial AsyncStorage hydrate has finished. Screens
  // can wait on this before deciding "logged in or not".
  hydrated: boolean;

  // ─── Actions ───
  /** One-shot boot hydrate — called once from App.tsx. */
  hydrate: () => Promise<void>;
  /** Replace the whole user object (login, full refresh). */
  setUser: (user: AppUser | null) => void;
  /** Merge a partial update into the user (profile edits, avatar). */
  patchUser: (patch: Partial<AppUser>) => void;
  /** Set the app mode (customer | agent). */
  setMode: (mode: UserMode | null) => void;
  /** Set the UI language code. */
  setLanguage: (language: string) => void;
  /** Clear the user on logout (mode/language are intentionally kept). */
  clearUser: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  mode: null,
  language: 'en',
  hydrated: false,

  hydrate: async () => {
    try {
      const [user, mode] = await Promise.all([getUser(), getUserMode()]);
      set({ user: user || null, mode: mode || null, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  setUser: (user) => {
    set({ user });
    // Write through to AsyncStorage so non-migrated screens stay in sync.
    storeUser(user || {}).catch(() => {});
  },

  patchUser: (patch) => {
    const merged = { ...(get().user || {}), ...patch } as AppUser;
    set({ user: merged });
    storeUser(merged).catch(() => {});
  },

  setMode: (mode) => {
    set({ mode });
    if (mode) setUserMode(mode).catch(() => {});
  },

  setLanguage: (language) => set({ language }),

  clearUser: () => set({ user: null }),
}));
