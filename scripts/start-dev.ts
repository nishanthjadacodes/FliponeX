/**
 * Dev launcher — the one command that should always "just work" when you sit
 * down to develop. Replaces `npx expo start --dev-client`.
 *
 * Does these things BEFORE Metro boots, every single time:
 *   1. `adb reverse tcp:3001 tcp:3001` — phone's localhost:3001 → PC backend
 *   2. `adb reverse tcp:8081 tcp:8081` — phone's localhost:8081 → PC Metro
 *   3. Starts Metro bundler with the dev-client profile
 *   4. Re-applies the reverse mappings every 10s while Metro runs — adb
 *      bindings evaporate on USB jiggle / phone screen-lock-then-unlock /
 *      laptop sleep, and the dev client then dies with
 *      "Failed to connect to /127.0.0.1:8081". The watchdog reinstalls
 *      the mapping silently the moment the phone is reachable again, so
 *      you don't have to kill Metro every time.
 *
 * Always run this via `npm run start` — never raw `npx expo start`,
 * which skips the reverse-forward step entirely.
 */

/* eslint-disable no-console */
import { execSync, spawn } from 'child_process';

// How often we re-apply the adb reverse mappings while Metro is up.
// 10 seconds is the sweet spot — fast enough that a brief USB hiccup
// self-heals before the dev-client times out fetching the bundle,
// slow enough that the watchdog isn't visible noise.
const WATCHDOG_INTERVAL_MS = 10_000;
const FORWARDED_PORTS: Array<{ port: number; label: string }> = [
  { port: 3001, label: 'Backend API' },
  { port: 8081, label: 'Metro bundler' },
];

// Quietly run `adb reverse`. Returns true if the command succeeded.
// Suppresses stdout/stderr in the silent variant so the watchdog
// doesn't spam the console once per tick.
const adbReverse = (port: number, silent = false): boolean => {
  try {
    execSync(`adb reverse tcp:${port} tcp:${port}`, { stdio: 'pipe' });
    return true;
  } catch (e: any) {
    if (!silent) {
      const msg = (e?.stderr?.toString() || e?.message || '').trim().split('\n')[0];
      console.log(`  ✗ port ${port}: ${msg || 'adb reverse failed'}`);
    }
    return false;
  }
};

// Loud variant used on the initial pass — prints a status line per port.
const tryAdbReverse = (port: number, label: string): boolean => {
  const ok = adbReverse(port, true);
  if (ok) {
    console.log(`  ✓ ${label.padEnd(16)}  localhost:${port} → PC:${port}`);
  } else {
    console.log(`  ✗ ${label.padEnd(16)}  adb reverse failed`);
  }
  return ok;
};

// Track which forwards are currently up so the watchdog only logs a
// "restored" line when something flips from down→up — not every tick.
const lastKnownState = new Map<number, boolean>();

const refreshForwards = (silent: boolean): void => {
  for (const { port, label } of FORWARDED_PORTS) {
    const ok = adbReverse(port, silent);
    const prev = lastKnownState.get(port);
    if (silent && prev === false && ok) {
      // Recovered after a previous failure — let the dev know.
      console.log(`  ↻ ${label} forward restored (localhost:${port} → PC:${port})`);
    }
    lastKnownState.set(port, ok);
  }
};

const main = (): void => {
  console.log('\n▶ Setting up USB port forwarding (adb reverse)…');
  const ok3001 = tryAdbReverse(3001, 'Backend API');
  const ok8081 = tryAdbReverse(8081, 'Metro bundler');
  lastKnownState.set(3001, ok3001);
  lastKnownState.set(8081, ok8081);

  if (!ok3001 || !ok8081) {
    console.log('\n⚠  One or more forwards failed. Checklist:');
    console.log('   • Phone plugged in via USB?');
    console.log('   • USB debugging enabled (Settings → Developer options)?');
    console.log('   • "Allow USB debugging" dialog on phone approved?');
    console.log('   → Run:  adb devices   (should show device, not "unauthorized")');
    console.log('\n   Continuing anyway — watchdog will retry every 10s.\n');
  } else {
    console.log('\n✓ USB forwards active. Phone now reaches PC via localhost.\n');
  }

  // Self-healing watchdog. Reapplies the reverse mappings every 10s so
  // the dev client recovers automatically when USB blips. Silent on
  // success; logs only when a forward transitions back to working.
  const watchdog = setInterval(() => refreshForwards(true), WATCHDOG_INTERVAL_MS);

  console.log('▶ Starting Metro…\n');
  const child = spawn('npx', ['expo', 'start', '--dev-client'], {
    stdio: 'inherit',
    shell: true,
  });
  child.on('exit', (code: number | null) => {
    clearInterval(watchdog);
    process.exit(code ?? 0);
  });
};

main();
