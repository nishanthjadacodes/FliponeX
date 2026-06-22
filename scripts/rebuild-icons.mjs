// One-shot icon regenerator. Strips the black background from logo1.jpeg,
// then produces two 1024×1024 PNGs in assets/:
//   - icon.png            white background, full-bleed disc at 95%.
//   - adaptive-icon.png   transparent background, disc at 85% so Android's
//                          adaptive mask doesn't clip the brand.
//
// The Android adaptive backgroundColor is set to #FFFFFF in app.json, so
// the disc floats on clean white inside the system mask — no black
// anywhere, regardless of launcher mask shape (circle / squircle / square).
//
// Re-run after the logo asset changes, then `npx expo prebuild
// --platform android` to push the new icons into the mipmap-* folders.

import Jimp from 'jimp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(__dirname, '..', 'assets');

const SIZE = 1024;
const ADAPTIVE_SCALE = 0.65; // logo fills 65% of canvas, matching Gmail's M
                              // proportion — leaves clean white visible around
                              // the disc when Android masks the adaptive icon.
const LEGACY_SCALE = 0.70;   // same proportion for legacy / non-adaptive launchers
const BLACK_THRESHOLD = 40;  // R+G+B below this → treat as background

const source = await Jimp.read(path.join(assetsDir, 'logo1.jpeg'));

// Punch the black corners out of the JPEG → transparent. We use a simple
// luminance threshold; the disc's anti-aliased edge has yellow / red /
// blue all well above 40 in at least one channel, so it's preserved.
const masked = source.clone();
masked.scan(0, 0, masked.bitmap.width, masked.bitmap.height, function (x, y, idx) {
  const r = this.bitmap.data[idx];
  const g = this.bitmap.data[idx + 1];
  const b = this.bitmap.data[idx + 2];
  if (r < BLACK_THRESHOLD && g < BLACK_THRESHOLD && b < BLACK_THRESHOLD) {
    this.bitmap.data[idx + 3] = 0;
  }
});

const compose = async ({ scale, bgColor, outName }) => {
  const logoSize = Math.round(SIZE * scale);
  const offset = Math.round((SIZE - logoSize) / 2);
  const canvas = new Jimp(SIZE, SIZE, bgColor);
  const logo = masked.clone().resize(logoSize, logoSize);
  canvas.composite(logo, offset, offset);
  await canvas.writeAsync(path.join(assetsDir, outName));
  console.log(`wrote assets/${outName}`);
};

// icon.png — opaque white background + 95% logo. Used by iOS and by
// older Android launchers that don't read the adaptive icon.
await compose({ scale: LEGACY_SCALE, bgColor: 0xffffffff, outName: 'icon.png' });

// adaptive-icon.png — transparent background + 85% logo. The Android
// adaptive system composites this on top of adaptiveIcon.backgroundColor.
await compose({ scale: ADAPTIVE_SCALE, bgColor: 0x00000000, outName: 'adaptive-icon.png' });
