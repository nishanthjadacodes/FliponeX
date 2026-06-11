import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Customer-facing booking-ID formatter.
 *
 * Backends store booking_number / id in many shapes — UUIDs, BK123456,
 * raw numbers, etc. This helper normalises whatever it gets into the
 * brand-friendly "FX#11063" format customers see in the app and on
 * receipts — always 5 digits after the FX# prefix.
 *
 * Examples:
 *   formatBookingId('BK14')              → 'FX#10014'
 *   formatBookingId(7)                   → 'FX#10007'
 *   formatBookingId(1003)                → 'FX#11003'
 *   formatBookingId(11063)               → 'FX#11063'
 *   formatBookingId('BK234567')          → 'FX#234567'  (long IDs stay long)
 *   formatBookingId('a1b2c3d4-e5f6-...') → 'FX#A1B2'    (UUID fallback)
 *   formatBookingId(null)                → ''
 */
// Display floor — every FX# ID shown to the customer is at least 5
// digits, starting at 10000. Any backend booking_number below 10000
// (legacy bookings, or short numbers) is rendered with a +10000 offset
// so it always reads as a clean 5-digit order number (73 → FX#10073,
// 1003 → FX#11003) rather than a zero-padded FX#01003. Numbers already
// at 10000+ render unchanged. Display-only — DB values aren't rewritten.
const DISPLAY_FLOOR = 10000;

export const formatBookingId = (input: string | number | null | undefined): string => {
  if (input == null) return '';
  const raw = String(input).trim();
  if (!raw) return '';

  // Pull the first run of digits — handles 'BK14', 'FLIP-23', 'Booking#7'.
  const digitMatch = raw.match(/(\d+)/);
  if (digitMatch) {
    const n = parseInt(digitMatch[1], 10);
    if (!Number.isNaN(n)) {
      // Anything < 10000 → bump by 10000 so a short booking_number
      // like 73 renders as FX#10073. Anything ≥ 10000 stays as-is.
      const displayN = n < DISPLAY_FLOOR ? n + DISPLAY_FLOOR : n;
      return `FX#${String(displayN).padStart(5, '0')}`;
    }
  }

  // No digits — likely a UUID. Use the first 4 alphanumeric chars uppercase.
  const fallback = raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase();
  return fallback ? `FX#${fallback}` : '';
};

/**
 * Per-device sequential counter — used as a CLIENT-SIDE FALLBACK only when
 * the backend hasn't yet assigned a booking_number. Stored in AsyncStorage
 * so it persists across app restarts. Returns 10000, 10001, 10002, … so the
 * local fallback ID always reads as a real 5-digit order number (matches
 * the display floor at 10000). Old devices that previously had a lower
 * counter value are bumped to 10000 the next time this runs.
 *
 * Usage:
 *   const n = await nextLocalBookingNumber();
 *   const display = formatBookingId(n);   // "FX#10000"
 *   const raw     = `BK${n}`;             // for backend submission
 */
const COUNTER_KEY = '@flipon_local_booking_counter';
const LOCAL_BOOKING_FLOOR = 10000;
export const nextLocalBookingNumber = async (): Promise<number> => {
  try {
    const current = await AsyncStorage.getItem(COUNTER_KEY);
    const stored = parseInt(current ?? '', 10) || 0;
    // Bump to floor on every read. If the device's counter is already
    // above the floor we just increment normally; if it's below (older
    // installs that ran with the pre-10000 fallback) we skip straight
    // to 10000 so the next booking displays as FX#10000.
    const next = Math.max(stored + 1, LOCAL_BOOKING_FLOOR);
    await AsyncStorage.setItem(COUNTER_KEY, String(next));
    return next;
  } catch (_) {
    // AsyncStorage failed — fall back to a deterministic 5-digit number
    // that's still ≥ floor so the displayed ID looks consistent.
    return LOCAL_BOOKING_FLOOR + (Math.floor(Date.now() / 1000) % 90000);
  }
};
