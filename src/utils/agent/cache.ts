import AsyncStorage from '@react-native-async-storage/async-storage';

// Tiny wrapper around AsyncStorage so screens can show the last-known-good
// data instantly while a fresh network request runs in the background.
//
//   await writeCache('tasks:all', { tasks: [...] })
//   const cached = await readCache('tasks:all')    // { value, age } | null
//
// `age` is milliseconds since the cache entry was written — useful if a
// caller wants to ignore very stale entries.

const keyOf = (name: string): string => `cache:${name}`;

export interface CacheEntry<T = unknown> {
  value: T;
  age: number;
}

export const writeCache = async <T>(name: string, value: T): Promise<void> => {
  try {
    const payload = JSON.stringify({ v: value, t: Date.now() });
    await AsyncStorage.setItem(keyOf(name), payload);
  } catch (e: any) {
    console.log('writeCache failed', name, e?.message);
  }
};

export const readCache = async <T = unknown>(name: string): Promise<CacheEntry<T> | null> => {
  try {
    const raw = await AsyncStorage.getItem(keyOf(name));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return { value: parsed.v as T, age: Date.now() - (parsed.t || 0) };
  } catch (e: any) {
    console.log('readCache failed', name, e?.message);
    return null;
  }
};

export const clearCache = async (name: string): Promise<void> => {
  try {
    await AsyncStorage.removeItem(keyOf(name));
  } catch {}
};
