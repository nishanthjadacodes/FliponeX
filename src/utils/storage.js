import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = '@flipon_token';
const USER_KEY = '@flipon_user';
const B2B_MODE_KEY = '@flipon_b2b_mode';
const MOBILE_KEY = '@flipon_mobile';
// Persisted react-navigation state — written by NavigationContainer in App.js
// so a cold start restores the exact screen the user was on.
export const NAV_STATE_KEY = '@flipon_nav_state';

// Clear everything that ties the device to the current account. Must be
// called from every logout handler so the next cold start doesn't restore
// an authenticated screen with no token.
export const clearAuthSession = async () => {
  try {
    await AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY, NAV_STATE_KEY]);
  } catch (error) {
    console.error('Error clearing session:', error);
  }
};

export const storeToken = async (token) => {
  try {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch (error) {
    console.error('Error storing token:', error);
  }
};

export const getToken = async () => {
  try {
    return await AsyncStorage.getItem(TOKEN_KEY);
  } catch (error) {
    console.error('Error getting token:', error);
    return null;
  }
};

export const removeToken = async () => {
  try {
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch (error) {
    console.error('Error removing token:', error);
  }
};

export const storeUser = async (user) => {
  try {
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (error) {
    console.error('Error storing user:', error);
  }
};

export const getUser = async () => {
  try {
    const user = await AsyncStorage.getItem(USER_KEY);
    return user ? JSON.parse(user) : null;
  } catch (error) {
    console.error('Error getting user:', error);
    return null;
  }
};

export const removeUser = async () => {
  try {
    await AsyncStorage.removeItem(USER_KEY);
  } catch (error) {
    console.error('Error removing user:', error);
  }
};

export const storeB2BMode = async (mode) => {
  try {
    await AsyncStorage.setItem(B2B_MODE_KEY, mode);
  } catch (error) {
    console.error('Error storing B2B mode:', error);
  }
};

export const getB2BMode = async () => {
  try {
    return await AsyncStorage.getItem(B2B_MODE_KEY);
  } catch (error) {
    console.error('Error getting B2B mode:', error);
    return null;
  }
};

export const removeB2BMode = async () => {
  try {
    await AsyncStorage.removeItem(B2B_MODE_KEY);
  } catch (error) {
    console.error('Error removing B2B mode:', error);
  }
};

export const storeMobile = async (mobile) => {
  try {
    await AsyncStorage.setItem(MOBILE_KEY, mobile);
  } catch (error) {
    console.error('Error storing mobile:', error);
  }
};

export const getStoredMobile = async () => {
  try {
    return await AsyncStorage.getItem(MOBILE_KEY);
  } catch (error) {
    console.error('Error getting stored mobile:', error);
    return null;
  }
};

export const removeStoredMobile = async () => {
  try {
    await AsyncStorage.removeItem(MOBILE_KEY);
  } catch (error) {
    console.error('Error removing stored mobile:', error);
  }
};
