// Booking-address renderer used wherever we display a booking's
// `address` / `service_address` field. The backend column accepts
// either a free-text string OR a JSON object of shape
// { latitude, longitude, formatted } — the customer app writes the
// object form when the user books with GPS turned on. Rendering an
// object directly inside <Text> throws "Objects are not valid as a
// React child" and crashes the Bookings tab on every device that
// already has at least one GPS-booked entry. This helper guarantees
// a renderable string out, plus opportunistically rewrites bare
// "lat,lng" pairs to a friendlier "📍 Map pin: …" label so customers
// don't see naked coordinates.

export const normalizeAddress = (raw: unknown): string => {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.formatted === 'string' && obj.formatted) return obj.formatted;
    if (typeof obj.address === 'string' && obj.address) return obj.address;
    if (obj.latitude != null && obj.longitude != null) {
      return `${obj.latitude},${obj.longitude}`;
    }
    // Last resort — pick the first usable string property so we never
    // hand the raw object back to React's renderer.
    const firstStr = Object.values(obj).find((v) => typeof v === 'string' && v);
    return (firstStr as string) || '';
  }
  return '';
};

// Display version — rewrites a bare "lat,lng" string into a labelled
// map-pin string. Pass the suffix `withTapHint=true` when the
// surrounding `<Text>` is tappable so users know they can open Maps.
export const formatBookingAddress = (
  raw: unknown,
  options: { withTapHint?: boolean; precision?: number } = {},
): string => {
  const normalised = normalizeAddress(raw);
  if (!normalised) return '';
  const m = normalised.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
  if (m) {
    const p = options.precision ?? 4;
    const lat = Number(m[1]).toFixed(p);
    const lng = Number(m[2]).toFixed(p);
    const suffix = options.withTapHint ? ' (tap to open)' : '';
    return `📍 Map pin: ${lat}, ${lng}${suffix}`;
  }
  return normalised;
};
