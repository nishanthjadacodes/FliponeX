import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Customer-facing booking-ID formatter.
 *
 * Backends store booking_number / id in many shapes — UUIDs, BK123456,
 * raw numbers, etc. This helper normalises whatever it gets into the
 * brand-friendly "Flip#0001" format that customers see in the app and on
 * receipts. 4-digit padding (was 3) — gives room up to 9,999 bookings
 * before the format breaks visually, and makes early IDs read as
 * "Flip#0014" instead of the cramped "Flip#014".
 *
 * Examples:
 *   formatBookingId('BK14')              → 'Flip#0014'
 *   formatBookingId(7)                   → 'Flip#0007'
 *   formatBookingId(1002)                → 'Flip#1002'
 *   formatBookingId('BK000123')          → 'Flip#0123'
 *   formatBookingId('BK234567')          → 'Flip#234567'  (long IDs stay long)
 *   formatBookingId('a1b2c3d4-e5f6-...') → 'Flip#A1B2'    (UUID fallback)
 *   formatBookingId(null)                → ''
 */
export const formatBookingId = (input: string | number | null | undefined): string => {
  if (input == null) return '';
  const raw = String(input).trim();
  if (!raw) return '';

  // Pull the first run of digits — handles 'BK14', 'FLIP-23', 'Booking#7'.
  const digitMatch = raw.match(/(\d+)/);
  if (digitMatch) {
    const n = parseInt(digitMatch[1], 10);
    if (!Number.isNaN(n)) {
      return `Flip#${String(n).padStart(4, '0')}`;
    }
  }

  // No digits — likely a UUID. Use the first 4 alphanumeric chars uppercase.
  const fallback = raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
  return fallback ? `Flip#${fallback}` : '';
};

/**
 * Per-device sequential counter — used as a CLIENT-SIDE FALLBACK only when
 * the backend hasn't yet assigned a booking_number. Stored in AsyncStorage
 * so it persists across app restarts. Returns 1000, 1001, 1002, … so the
 * local fallback ID always reads as a real 4-digit order number (matches
 * the backend's floor at 1000). Old devices that previously had a
 * pre-1000 counter value are bumped to 1000 the next time this runs.
 *
 * Usage:
 *   const n = await nextLocalBookingNumber();
 *   const display = formatBookingId(n);   // "Flip#1000"
 *   const raw     = `BK${n}`;             // for backend submission
 */
const COUNTER_KEY = '@flipon_local_booking_counter';
const LOCAL_BOOKING_FLOOR = 1000;
export const nextLocalBookingNumber = async (): Promise<number> => {
  try {
    const current = await AsyncStorage.getItem(COUNTER_KEY);
    const stored = parseInt(current ?? '', 10) || 0;
    // Bump to floor on every read. If the device's counter is already
    // above the floor we just increment normally; if it's below (older
    // installs that ran with the pre-1000 fallback) we skip straight
    // to 1000 so the next booking displays as Flip#1000.
    const next = Math.max(stored + 1, LOCAL_BOOKING_FLOOR);
    await AsyncStorage.setItem(COUNTER_KEY, String(next));
    return next;
  } catch (_) {
    // AsyncStorage failed — fall back to a deterministic 4-digit number
    // that's still ≥ floor so the displayed ID looks consistent.
    return LOCAL_BOOKING_FLOOR + (Math.floor(Date.now() / 1000) % 9000);
  }
};
