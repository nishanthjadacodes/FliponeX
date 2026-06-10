// ─── API URL configuration ──────────────────────────────────────────────────
// Production backend is deployed on Render. Dev fallbacks (localhost / LAN)
// are kept in the candidates chain so `npm run dev` still works locally if
// the Render instance is cold/unreachable.
// ────────────────────────────────────────────────────────────────────────────
export const API_BASE_URL = 'https://flipon-backend.onrender.com/api';
export const SOCKET_URL = 'https://flipon-backend.onrender.com';

// Fallback chain — api.js tries these in order on ERR_NETWORK.
export const API_BASE_URL_CANDIDATES: readonly string[] = [
  'https://flipon-backend.onrender.com/api',
  'http://localhost:3001/api',
  'http://10.47.135.253:3001/api',
] as const;

// ─── Embedded web surfaces (Next.js projects) ──────────────────────────────
// These are the two sibling Next.js apps (admindashboard1 + Customerwebsite)
// embedded into the mobile APK via react-native-webview. The APK itself
// can't bundle the site files — it loads them from a URL. So both sites
// must be deployed somewhere publicly reachable (Vercel is simplest).
//
// Deployed Next.js sites on Vercel (free tier). Each redeploy keeps the
// same URL, so tester APKs don't need rebuilding when the site changes.
//
// If you later set up a shorter stable alias in Vercel → Project → Domains
// (e.g. fliponex.vercel.app / admindashboard.vercel.app), swap the strings
// below — same single place, both URLs.
// Custom domain — the admin console (FliponeX Admin Console landing +
// "Sign In to Admin Console" CTA) now lives on www.fliponex.com. The
// previous Vercel preview alias (admindashboard-topaz-six.vercel.app)
// is stale; this is the canonical production URL.
export const ADMIN_DASHBOARD_URL = 'https://www.fliponex.com';

// Use the STABLE Vercel project alias (fliponex-web.vercel.app), not the
// random per-deployment URL — that one rotates on every redeploy and would
// strand the APK on whatever build was current when this was hardcoded.
export const CUSTOMER_WEBSITE_URL = 'https://fliponex-web.vercel.app';
