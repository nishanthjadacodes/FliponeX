import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerPushToken } from '../services/api';

// Defensive loading — expo-notifications and expo-device are native modules.
// If the installed APK predates `npm install`, calls fail. We short-circuit
// to a no-op in that case so the app still boots.
//
// `any` here is intentional: these modules are loaded at runtime only when
// the native side is linked, so static typing buys us nothing.
let Notifications: any = null;
let Device: any = null;
let moduleReady = false;
try {
  // eslint-disable-next-line global-require
  Notifications = require('expo-notifications');
  // eslint-disable-next-line global-require
  Device = require('expo-device');
  moduleReady = !!(Notifications?.getExpoPushTokenAsync && Device?.isDevice !== undefined);
} catch (_) {
  moduleReady = false;
}

const PUSH_TOKEN_KEY = '@flipon_push_token';

// Foreground behaviour — show the notification banner even when app is open.
// Safe to call multiple times; Expo dedupes internally.
const configureHandler = (): void => {
  if (!moduleReady) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
};

// Android needs an explicit notification channel for heads-up banners.
const ensureAndroidChannel = async (): Promise<void> => {
  if (!moduleReady || Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'General',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0D3B66',
    });
  } catch (_) {}
};

// Main entry: call once after the user is authenticated. Asks permission,
// gets the Expo push token, caches it locally, and returns it so callers can
// upload to their backend (when that endpoint exists).
export const registerForPushNotifications = async (): Promise<string | null> => {
  if (!moduleReady) {
    console.log('[push] expo-notifications not linked yet — skipping (rebuild APK to enable)');
    return null;
  }
  try {
    if (!Device.isDevice) {
      console.log('[push] running on simulator/emulator — skipping token fetch');
      return null;
    }

    configureHandler();
    await ensureAndroidChannel();

    // Permission — returns { status: 'granted' | 'denied' | 'undetermined' }
    const existing = await Notifications.getPermissionsAsync();
    let status: string = existing.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') {
      console.log('[push] permission not granted by user');
      return null;
    }

    const tokenResp = await Notifications.getExpoPushTokenAsync();
    const token: string | undefined = tokenResp?.data;
    if (!token) return null;

    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    console.log('[push] device token (first 20 chars):', token.slice(0, 20) + '…');

    // Upload to backend so it can be used for server-side sends. Only upload
    // if we haven't already registered THIS exact token with the backend.
    const lastUploaded = await AsyncStorage.getItem(`${PUSH_TOKEN_KEY}_uploaded`);
    if (lastUploaded !== token) {
      try {
        await registerPushToken(token, Platform.OS);
        await AsyncStorage.setItem(`${PUSH_TOKEN_KEY}_uploaded`, token);
        console.log('[push] token uploaded to backend');
      } catch (e: any) {
        // Non-fatal — user may not be authenticated yet. The next successful
        // registration call will upload.
        console.log('[push] backend upload failed (will retry next launch):', e?.message);
      }
    }
    return token;
  } catch (e: any) {
    console.log('[push] registration failed:', e?.message || e);
    return null;
  }
};

export const getCachedPushToken = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  } catch (_) {
    return null;
  }
};

// Subscribe to taps on notifications. The listener receives the notification
// payload; use the `data` field to route (e.g. enquiry_id → EnquiryDetails).
export type NotificationData = Record<string, unknown>;
export const addNotificationTapListener = (
  handler: (data: NotificationData) => void,
): (() => void) => {
  if (!moduleReady) return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((response: any) => {
    const data: NotificationData = response?.notification?.request?.content?.data || {};
    try {
      handler(data);
    } catch (e: any) {
      console.log('[push] tap handler error:', e?.message);
    }
  });
  return () => sub.remove();
};
