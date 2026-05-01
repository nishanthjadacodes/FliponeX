import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '../types';

const TOKEN_KEY = '@flipon_token';
const USER_KEY = '@flipon_user';
const B2B_MODE_KEY = '@flipon_b2b_mode';
const MOBILE_KEY = '@flipon_mobile';
// Top-level app mode selected on the ModeSelect screen. One of:
//   'customer' — standard consumer/B2B flow (HomeTabs)
//   'agent'    — agent / field-worker app (AgentTabs)
// Role-exclusive per product policy — a user account is either customer or
// agent, never both. The choice here determines which stack the navigator
// mounts after Splash.
const USER_MODE_KEY = '@flipon_user_mode';
// Persisted react-navigation state — written by NavigationContainer in App.js
// so a cold start restores the exact screen the user was on.
export const NAV_STATE_KEY = '@flipon_nav_state';

export type UserMode = 'customer' | 'agent';

// Clear everything that ties the device to the current account. Must be
// called from every logout handler so the next cold start doesn't restore
// an authenticated screen with no token.
export const clearAuthSession = async (): Promise<void> => {
  try {
    await AsyncStorage.multiRemove([
      TOKEN_KEY,
      USER_KEY,
      NAV_STATE_KEY,
      USER_MODE_KEY,
      'my_bookings',
      'existing_bookings',
      'agent_token',
      'agent_data',
    ]);
  } catch (error) {
    console.error('Error clearing session:', error);
  }
};

export const storeToken = async (token: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch (error) {
    console.error('Error storing token:', error);
  }
};

export const getToken = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch (error) {
    console.error('Error getting token:', error);
    return null;
  }
};

export const removeToken = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch (error) {
    console.error('Error removing token:', error);
  }
};

export const storeUser = async (user: User | Record<string, unknown>): Promise<void> => {
  try {
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (error) {
    console.error('Error storing user:', error);
  }
};

export const getUser = async (): Promise<User | null> => {
  try {
    const user = await AsyncStorage.getItem(USER_KEY);
    return user ? (JSON.parse(user) as User) : null;
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
};

export const removeUser = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(USER_KEY);
  } catch (error) {
    console.error('Error removing user:', error);
  }
};

export const storeB2BMode = async (mode: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(B2B_MODE_KEY, mode);
  } catch (error) {
    console.error('Error storing B2B mode:', error);
  }
};

export const getB2BMode = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(B2B_MODE_KEY);
  } catch (error) {
    console.error('Error getting B2B mode:', error);
    return null;
  }
};

export const removeB2BMode = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(B2B_MODE_KEY);
  } catch (error) {
    console.error('Error removing B2B mode:', error);
  }
};

export const storeMobile = async (mobile: string): Promise<void> => {
  try {
    await AsyncStorage.setItem(MOBILE_KEY, mobile);
  } catch (error) {
    console.error('Error storing mobile:', error);
  }
};

export const getStoredMobile = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem(MOBILE_KEY);
  } catch (error) {
    console.error('Error getting stored mobile:', error);
    return null;
  }
};

export const removeStoredMobile = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(MOBILE_KEY);
  } catch (error) {
    console.error('Error removing stored mobile:', error);
  }
};

// ─── User mode (customer | agent) ───────────────────────────────────────
// Written once on the ModeSelect screen; read on every cold start so the
// NavigationContainer can route into the right stack.
export const setUserMode = async (mode: UserMode): Promise<void> => {
  try {
    if (mode !== 'customer' && mode !== 'agent') return;
    await AsyncStorage.setItem(USER_MODE_KEY, mode);
  } catch (error) {
    console.error('Error saving user mode:', error);
  }
};

export const getUserMode = async (): Promise<UserMode | null> => {
  try {
    const v = await AsyncStorage.getItem(USER_MODE_KEY);
    return v === 'customer' || v === 'agent' ? (v as UserMode) : null;
  } catch (error) {
    console.error('Error reading user mode:', error);
    return null;
  }
};

export const clearUserMode = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(USER_MODE_KEY);
  } catch (error) {
    console.error('Error clearing user mode:', error);
  }
};
