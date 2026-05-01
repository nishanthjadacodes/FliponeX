// ─────────────────────────────────────────────────────────────────────────────
// API URL Configuration (AgentApp)
// ─────────────────────────────────────────────────────────────────────────────
// The built-in default below is for local dev only.  At runtime the user can
// override it from the Login screen's "Server Settings" action — the override
// is persisted in AsyncStorage and survives reinstalls of the JS bundle.
// ─────────────────────────────────────────────────────────────────────────────
import AsyncStorage from '@react-native-async-storage/async-storage';

// Production deployment on Render. Overridable at runtime from the in-app
// "Server Settings" action if you need to point at a local backend for dev.
const DEFAULT_API_URL = 'https://flipon-backend.onrender.com/api';
const STORAGE_KEY = 'api_base_url_override';

let cachedUrl: string = DEFAULT_API_URL;
let initialized = false;

// Call once at app start so the cached value reflects any saved override.
export const initApiUrl = async (): Promise<void> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored && typeof stored === 'string' && stored.trim().length > 0) {
      cachedUrl = stored.trim();
    }
  } catch (e: any) {
    console.log('initApiUrl: storage read failed, using default', e?.message);
  } finally {
    initialized = true;
  }
};

export const getApiBaseUrl = (): string => cachedUrl;

export const setApiBaseUrl = async (url: string | null | undefined): Promise<void> => {
  const trimmed = (url || '').trim();
  cachedUrl = trimmed || DEFAULT_API_URL;
  try {
    if (trimmed) await AsyncStorage.setItem(STORAGE_KEY, trimmed);
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (e: any) {
    console.log('setApiBaseUrl: storage write failed', e?.message);
  }
};

export const resetApiBaseUrl = async (): Promise<void> => {
  cachedUrl = DEFAULT_API_URL;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {}
};

export const isApiUrlInitialized = (): boolean => initialized;
export const getDefaultApiUrl = (): string => DEFAULT_API_URL;

// Legacy named export kept for any imports that still reference it directly.
// Note: this captures the value at import time — always prefer getApiBaseUrl().
export const API_BASE_URL: string = DEFAULT_API_URL;
