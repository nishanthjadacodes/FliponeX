import * as Location from 'expo-location';
import * as ExpoImagePicker from 'expo-image-picker';
import {
  usePermissionRationaleStore,
  type PermissionKind,
} from '../store/usePermissionRationaleStore';

// Shape every "asker" implements: a cheap, non-prompting check and a
// real OS prompt request. The rationale helper uses the check to short
// out when permission is already granted (no modal flash) and the
// request only after the user agrees to the in-app rationale.
export interface PermissionAsker {
  check: () => Promise<{ granted: boolean }>;
  request: () => Promise<{ granted: boolean }>;
}

// expo-image-picker is what we use for camera + media-library permission
// plumbing because react-native-image-crop-picker (the actual UI we
// show) shares the underlying OS permission. Once granted via Expo's
// request, openCamera/openPicker proceed without re-prompting.
export const cameraAsker: PermissionAsker = {
  check: async () => ({
    granted: (await ExpoImagePicker.getCameraPermissionsAsync()).granted,
  }),
  request: async () => ({
    granted: (await ExpoImagePicker.requestCameraPermissionsAsync()).granted,
  }),
};

// Photo library is gated via the Android Photo Picker (API 33+) which
// needs no permission at all — Google Play 2024+ policy explicitly
// requires this pattern for apps with infrequent photo access (our case:
// occasional document + avatar uploads). We therefore short-circuit the
// asker to always-granted: launchImageLibraryAsync / openPicker resolve
// to the system Photo Picker dialog and the user selects what they want
// to share, no system-level permission grant required.
export const galleryAsker: PermissionAsker = {
  check: async () => ({ granted: true }),
  request: async () => ({ granted: true }),
};

export const locationAsker: PermissionAsker = {
  check: async () => ({
    granted: (await Location.getForegroundPermissionsAsync()).status === 'granted',
  }),
  request: async () => ({
    granted: (await Location.requestForegroundPermissionsAsync()).status === 'granted',
  }),
};

// Notifications is loaded defensively because the native module may not
// be linked in older dev-client builds — mirrors the pattern already in
// utils/notifications.ts. The check returns `granted=false` when
// unavailable so callers degrade to "no notifications" instead of crash.
let Notifications: any = null;
try {
  // eslint-disable-next-line global-require
  Notifications = require('expo-notifications');
} catch (_) {
  Notifications = null;
}

export const notificationsAsker: PermissionAsker = {
  check: async () => {
    if (!Notifications?.getPermissionsAsync) return { granted: false };
    return { granted: (await Notifications.getPermissionsAsync()).status === 'granted' };
  },
  request: async () => {
    if (!Notifications?.requestPermissionsAsync) return { granted: false };
    return { granted: (await Notifications.requestPermissionsAsync()).status === 'granted' };
  },
};

export interface PermissionCopy {
  icon: string;
  title: string;
  bullets: string[];
  continueLabel?: string;
  declineLabel?: string;
}

// In-app rationale copy. Kept short — title + 3 bullets max — and aligned
// with the OS prompt strings in app.json so we're not promising one
// thing here and showing different OS copy a moment later.
export const PERMISSION_COPY: Record<PermissionKind, PermissionCopy> = {
  camera: {
    icon: 'photo-camera',
    title: 'Allow camera access?',
    bullets: [
      'Capture photos of documents for your booking',
      'Photos only — no audio is recorded',
      'Used only when you tap a camera button',
    ],
  },
  gallery: {
    icon: 'photo-library',
    title: 'Allow photo library access?',
    bullets: [
      'Pick existing photos of documents to upload',
      'You choose what gets uploaded — nothing automatic',
      'We never browse your library on our own',
    ],
  },
  location: {
    icon: 'location-on',
    title: 'Allow location access?',
    bullets: [
      'Auto-fill your service address',
      'Find your nearest agent for faster pickup',
      'Used only when you tap "Use my location"',
    ],
  },
  notifications: {
    icon: 'notifications-active',
    title: 'Allow notifications?',
    bullets: [
      'Get booking and document status updates',
      'Hear about new offers (you can mute these later)',
      'No marketing without your consent',
    ],
  },
};

// Main entry point. Used in place of a raw OS request anywhere we want
// the user to see context before the system dialog fires. Behavior:
//
//   1. If permission is already granted → return immediately, no UI.
//      Existing call sites keep their fast-path behavior.
//   2. Otherwise → show the rationale modal and await the user's
//      decision. On "Continue" → fire the real OS request. On "Not
//      now" → return granted=false WITHOUT firing the OS dialog so
//      the user can be re-prompted next time they actually attempt
//      the gated action (instead of burning their one OS prompt).
export async function requestPermissionWithRationale(
  kind: PermissionKind,
  asker: PermissionAsker,
): Promise<{ granted: boolean }> {
  const current = await asker.check();
  if (current.granted) return { granted: true };

  const allow = await usePermissionRationaleStore.getState().show(kind);
  if (!allow) return { granted: false };

  return await asker.request();
}
