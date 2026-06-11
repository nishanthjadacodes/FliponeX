import { create } from 'zustand';

// Permission kinds the in-app rationale modal explains. Adding a new
// kind is a 4-step process: extend this union, add COPY in
// utils/permissions.ts, add an `asker` (check + request) there, and
// reuse the existing helper at the call site. Modal + store stay generic.
export type PermissionKind = 'camera' | 'gallery' | 'location' | 'notifications';

interface PermissionRationaleState {
  visible: boolean;
  kind: PermissionKind | null;
  // Internal: held while the modal is open so allow()/deny() can
  // resolve the same Promise the caller is awaiting.
  _resolve: ((allow: boolean) => void) | null;

  // Show the modal for `kind`; returns a Promise that resolves to
  // `true` if the user tapped Continue, `false` for Not now / dismissed.
  // If a previous modal is somehow still open (shouldn't happen in
  // normal flow), the prior promise resolves `false` so it doesn't hang.
  show: (kind: PermissionKind) => Promise<boolean>;
  allow: () => void;
  deny: () => void;
}

export const usePermissionRationaleStore = create<PermissionRationaleState>((set, get) => ({
  visible: false,
  kind: null,
  _resolve: null,

  show: (kind) => {
    const prior = get()._resolve;
    if (prior) prior(false);
    return new Promise<boolean>((resolve) => {
      set({ visible: true, kind, _resolve: resolve });
    });
  },

  allow: () => {
    const r = get()._resolve;
    set({ visible: false, kind: null, _resolve: null });
    r?.(true);
  },

  deny: () => {
    const r = get()._resolve;
    set({ visible: false, kind: null, _resolve: null });
    r?.(false);
  },
}));
