import * as Location from 'expo-location';

export interface LatLng {
  latitude: number;
  longitude: number;
}

// ─── Process-lifetime caches ─────────────────────────────────────────────────
let agentPos: LatLng | null = null;
let agentPosFetchedAt = 0;
let agentPermissionDenied = false;
const AGENT_POS_TTL_MS = 5 * 60 * 1000; // 5 min

// Normalised address → { latitude, longitude } | null (negative cache)
const geocodeCache = new Map<string, LatLng | null>();

const normaliseAddress = (a: string | null | undefined): string =>
  (a || '').trim().toLowerCase().replace(/\s+/g, ' ');

// ─── Public API ─────────────────────────────────────────────────────────────
export const getAgentPosition = async (): Promise<LatLng | null> => {
  if (agentPermissionDenied) return null;
  const now = Date.now();
  if (agentPos && now - agentPosFetchedAt < AGENT_POS_TTL_MS) return agentPos;

  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      perm = await Location.requestForegroundPermissionsAsync();
    }
    if (perm.status !== 'granted') {
      agentPermissionDenied = true;
      return null;
    }
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    agentPos = {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    };
    agentPosFetchedAt = now;
    return agentPos;
  } catch (e: any) {
    console.log('getAgentPosition failed:', e?.message);
    return null;
  }
};

export const geocodeAddress = async (address: string | null | undefined): Promise<LatLng | null> => {
  const key = normaliseAddress(address);
  if (!key) return null;
  if (geocodeCache.has(key)) return geocodeCache.get(key) ?? null;
  try {
    const res = await Location.geocodeAsync(address as string);
    if (res && res.length > 0) {
      const coords: LatLng = { latitude: res[0].latitude, longitude: res[0].longitude };
      geocodeCache.set(key, coords);
      return coords;
    }
  } catch (e: any) {
    console.log('geocodeAddress failed:', e?.message);
  }
  geocodeCache.set(key, null); // negative cache — don't retry failing addresses
  return null;
};

const haversineKm = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
  const R = 6371;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
};

export const formatDistance = (km: number | null | undefined): string => {
  if (km == null || isNaN(km)) return 'N/A';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
};

// Try to read coordinates DIRECTLY from the booking's stored address
// before falling back to text geocoding. Two shapes we handle without
// hitting the network:
//
//   1. The customer app stored a JSON object like
//      `{ latitude, longitude, formatted }` (happens when the user
//      tapped "Use my location" in the booking flow).
//   2. The address was stored as a stringified coordinate pair —
//      `"28.123456, 79.654321"` — which is what older customer-app
//      builds shipped when GPS was used. Android's Location.geocodeAsync
//      reliably fails on this format (it's not a real address), so
//      without this short-circuit the agent's "View Details" showed
//      "Tap address to navigate" instead of the real distance.
//
// Falls through to text geocoding (the old code path) only when the
// address is genuinely a typed-out free-text address.
const parseCoordsFrom = (address: unknown): LatLng | null => {
  if (!address) return null;
  if (typeof address === 'object') {
    const obj = address as Record<string, unknown>;
    const lat = Number(obj.latitude ?? obj.lat);
    const lng = Number(obj.longitude ?? obj.lng ?? obj.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat, longitude: lng };
    }
    return null;
  }
  if (typeof address === 'string') {
    // Match "<lat>, <lng>" with optional whitespace and a sign.
    const m = address.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { latitude: lat, longitude: lng };
      }
    }
  }
  return null;
};

export const computeDistanceToAddress = async (
  address: unknown,
): Promise<number | null> => {
  // Fast path — coordinates were captured upstream, no need to geocode.
  const direct = parseCoordsFrom(address);
  if (direct) {
    const pos = await getAgentPosition();
    if (!pos) return null;
    return haversineKm(pos.latitude, pos.longitude, direct.latitude, direct.longitude);
  }

  // Slow path — fall back to geocoding the free-text address.
  const addrString =
    typeof address === 'string'
      ? address
      : address && typeof address === 'object'
        ? ((address as any).formatted as string | undefined) || ''
        : '';
  const [pos, dest] = await Promise.all([
    getAgentPosition(),
    geocodeAddress(addrString),
  ]);
  if (!pos || !dest) return null;
  return haversineKm(pos.latitude, pos.longitude, dest.latitude, dest.longitude);
};

export const resetDistanceCaches = (): void => {
  agentPos = null;
  agentPosFetchedAt = 0;
  agentPermissionDenied = false;
  geocodeCache.clear();
};
