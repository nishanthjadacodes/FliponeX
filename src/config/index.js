// ─────────────────────────────────────────────────────────────────────────────
// API URL Configuration
// ─────────────────────────────────────────────────────────────────────────────
// Change ONLY the URL on the active line. The path is the same in dev/prod.
//
// ▶ DEV (with phone connected via USB) — RECOMMENDED:
//   1. Connect phone to PC via USB cable
//   2. In a terminal run ONCE per dev session:  adb reverse tcp:3001 tcp:3001
//   3. Phone forwards "localhost:3001" → your PC's localhost
//   4. NO IP changes ever needed — just run adb reverse when you start dev
//
// ▶ DEV (wireless / remote testing) — use ngrok:
//   - Sign up at https://ngrok.com → claim free static domain
//   - Run:  ngrok http --domain=YOUR_DOMAIN.ngrok-free.app 3001
//   - Set: API_BASE_URL = 'https://YOUR_DOMAIN.ngrok-free.app/api'
//
// ▶ PRODUCTION (when launching to real customers):
//   - Deploy backend to Render/Railway/AWS/DigitalOcean
//   - Set: API_BASE_URL = 'https://api.flipon.com/api'  (your real domain)
//   - Build a release APK → distribute to customers
//   - Customers will hit the cloud server, not your PC
// ─────────────────────────────────────────────────────────────────────────────

export const API_BASE_URL = 'http://10.42.65.253:3001/api';
