/**
 * Dev launcher — the one command that should always "just work" when you sit
 * down to develop. Replaces `npx expo start --dev-client`.
 *
 * Does these things BEFORE Metro boots, every single time:
 *   1. `adb reverse tcp:3001 tcp:3001` — phone's localhost:3001 → PC backend
 *   2. `adb reverse tcp:8081 tcp:8081` — phone's localhost:8081 → PC Metro
 *   3. Starts Metro bundler with the dev-client profile
 *
 * Why this file exists: adb reverse bindings evaporate on USB unplug / phone
 * reboot / PC sleep. Coming back after 2 days, the phone has a cached
 * `127.0.0.1:8081` URL that goes nowhere — so the dev-client screen shows
 * "failed to connect to /127.0.0.1:8081". Re-running these mappings every
 * session fixes it.
 */

/* eslint-disable no-console */
import { execSync, spawn } from 'child_process';

const tryAdbReverse = (port: number, label: string): boolean => {
  try {
    execSync(`adb reverse tcp:${port} tcp:${port}`, { stdio: 'pipe' });
    console.log(`  ✓ ${label.padEnd(16)}  localhost:${port} → PC:${port}`);
    return true;
  } catch (e: any) {
    const msg = (e?.stderr?.toString() || e?.message || '').trim().split('\n')[0];
    console.log(`  ✗ ${label.padEnd(16)}  ${msg || 'adb reverse failed'}`);
    return false;
  }
};

const main = (): void => {
  console.log('\n▶ Setting up USB port forwarding (adb reverse)…');
  const ok3001 = tryAdbReverse(3001, 'Backend API');
  const ok8081 = tryAdbReverse(8081, 'Metro bundler');

  if (!ok3001 || !ok8081) {
    console.log('\n⚠  One or more forwards failed. Checklist:');
    console.log('   • Phone plugged in via USB?');
    console.log('   • USB debugging enabled (Settings → Developer options)?');
    console.log('   • "Allow USB debugging" dialog on phone approved?');
    console.log('   → Run:  adb devices   (should show device, not "unauthorized")');
    console.log('\n   Continuing anyway — if adb works later, re-run this script.\n');
  } else {
    console.log('\n✓ USB forwards active. Phone now reaches PC via localhost.\n');
  }

  console.log('▶ Starting Metro…\n');
  const child = spawn('npx', ['expo', 'start', '--dev-client'], {
    stdio: 'inherit',
    shell: true,
  });
  child.on('exit', (code: number | null) => process.exit(code ?? 0));
};

main();
