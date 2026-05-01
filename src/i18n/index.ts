import AsyncStorage from '@react-native-async-storage/async-storage';
import en from './en';
import hi from './hi';
import te from './te';

export type AppLanguage = 'en' | 'hi' | 'te';

const STORAGE_KEY = 'app_language';
const SUPPORTED: AppLanguage[] = ['en', 'hi', 'te'];

// Defensive require — i18n-js is added to package.json but may not be
// installed in the dev sandbox until `npm install` runs. Falls back to a
// minimal in-house translator so the app still boots and tsc still passes.
let I18n: any = null;
try {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const mod: any = require('i18n-js');
  // i18n-js v4 exports the I18n class on `.I18n` (named) or as default.
  const Ctor = mod?.I18n || mod?.default || mod;
  if (typeof Ctor === 'function') {
    I18n = new Ctor({ en, hi, te });
    I18n.defaultLocale = 'en';
    I18n.enableFallback = true;
    I18n.locale = 'en';
  }
} catch (_) {
  I18n = null;
}

// In-memory locale tracker for the fallback path.
let currentLocale: AppLanguage = 'en';

const TABLES: Record<AppLanguage, Record<string, string>> = {
  en: en as any,
  hi: hi as any,
  te: te as any,
};

const interpolate = (template: string, params?: Record<string, any>): string => {
  if (!params) return template;
  return template.replace(/\{\{?\s*(\w+)\s*\}?\}/g, (_m, k) => {
    const v = params[k];
    return v == null ? '' : String(v);
  });
};

export const t = (key: string, params?: Record<string, any>): string => {
  if (I18n && typeof I18n.t === 'function') {
    try {
      return I18n.t(key, params);
    } catch (_) {
      // fall through to local table
    }
  }
  const table = TABLES[currentLocale] || TABLES.en;
  const raw: string = (table as any)[key] ?? (TABLES.en as any)[key] ?? key;
  return interpolate(String(raw), params);
};

export const setAppLanguage = async (lang: AppLanguage): Promise<void> => {
  const next: AppLanguage = SUPPORTED.indexOf(lang) >= 0 ? lang : 'en';
  currentLocale = next;
  if (I18n) {
    I18n.locale = next;
  }
  try {
    await AsyncStorage.setItem(STORAGE_KEY, next);
  } catch (_) {
    // non-fatal
  }
};

export const loadAppLanguage = async (): Promise<void> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    const next: AppLanguage =
      stored && SUPPORTED.indexOf(stored as AppLanguage) >= 0
        ? (stored as AppLanguage)
        : 'en';
    currentLocale = next;
    if (I18n) {
      I18n.locale = next;
    }
  } catch (_) {
    currentLocale = 'en';
    if (I18n) {
      I18n.locale = 'en';
    }
  }
};

export default { t, setAppLanguage, loadAppLanguage };
