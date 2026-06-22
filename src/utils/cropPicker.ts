// Thin wrapper around react-native-image-crop-picker that:
//   • Falls back to expo-image-picker when the native module isn't
//     present in the bundle (older dev-client APKs, web preview),
//     so the build doesn't crash on `require(...)`.
//   • Returns a single, stable shape (`PickedFile`) regardless of
//     which underlying library produced the image.
//   • Centralises the cropper styling so every doc-upload surface
//     (booking, KYC, compliance vault, rep task) gets the same
//     branded "Crop" UI with a clearly-coloured confirm button —
//     unlike Android's plain-text system cropper.
//
// To use the styled cropper for real, run:
//     npm install                         # picks up package.json change
//     eas build --profile preview         # produces a new APK that
//                                         # bundles the native module
//
// Until the new APK lands, this helper still works: it just falls
// back to expo-image-picker and shows no crop UI.

import * as ExpoImagePicker from 'expo-image-picker';
import {
  cameraAsker,
  galleryAsker,
  requestPermissionWithRationale,
} from './permissions';

let CropPicker: any = null;
let cropPickerAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  CropPicker = require('react-native-image-crop-picker').default
    || require('react-native-image-crop-picker');
  cropPickerAvailable =
    typeof CropPicker?.openCamera === 'function' &&
    typeof CropPicker?.openPicker === 'function';
} catch (_) {
  cropPickerAvailable = false;
}

export interface PickedFile {
  uri: string;
  name: string;
  type: string; // mime, e.g. 'image/jpeg'
}

// Shared cropper colour set — matches the rest of the app's chrome.
const CROP_OPTIONS = {
  cropping: true,
  // freeStyleCropEnabled lets the user drag any corner to any aspect.
  // Width/height removed — fixed 1200x1600 was forcing a portrait
  // crop frame that didn't fit landscape Aadhaar/passport scans, so
  // the image rendered tiny in the centre with the crop box maxed
  // out at the doc's height. Letting the cropper auto-fit the
  // source dimensions makes the full image visible from the start.
  freeStyleCropEnabled: true,
  // Make sure the user can zoom OUT to see the entire image before
  // selecting the crop region. Default behaviour on some Android
  // builds clamps to the initial fill scale, which felt like the
  // crop view "wasn't taking the entire screen".
  enableRotationGesture: true,
  hideBottomControls: false,
  showCropFrame: true,
  showCropGuidelines: true,
  includeBase64: false,
  compressImageQuality: 0.85,
  // Cap the output dimensions. A modern OEM camera (Xiaomi / Realme /
  // Vivo phones ship 50–108MP sensors) would otherwise hand back a huge
  // bitmap that spikes memory on low-RAM devices and bloats the upload
  // on slow rural connections. 2400px keeps document text crisply
  // legible while keeping the file light and the decode cheap.
  compressImageMaxWidth: 2400,
  compressImageMaxHeight: 2400,
  mediaType: 'photo' as const,
  // Android UCrop styling — these props become a coloured toolbar +
  // a clearly-visible "Done" tick button on the right side of the
  // crop screen instead of Android's faint plain-text "CROP" label.
  cropperToolbarTitle: 'Crop document',
  cropperToolbarColor: '#0D3B66',
  cropperToolbarWidgetColor: '#FFFFFF',
  cropperActiveWidgetColor: '#10B981',
  // Status bar uses the brand gold accent — clear contrast against
  // the Prussian-blue toolbar, so the phone's clock + signal icons
  // sit on a visibly distinct strip ABOVE the cropper's tick and X.
  // Was identical Prussian-blue earlier, which made the toolbar
  // widgets appear to merge with the system icons. Android auto-
  // adjusts the system icons (clock / battery) to a darker tone on
  // light backgrounds via `windowLightStatusBar`, so the strip reads
  // as readable yellow with dark icons.
  cropperStatusBarColor: '#F9A825',
};

// Tagged error for "the user has denied photo/camera access". Callers
// catch this and prompt the user to open the app's settings — silently
// returning null would leave the user staring at an unresponsive
// picker button with no idea why.
export const PICKER_PERMISSION_DENIED = 'PICKER_PERMISSION_DENIED';

function makePermissionError(message?: string): Error {
  const err: any = new Error(message || 'Photo / camera access denied');
  err.code = PICKER_PERMISSION_DENIED;
  return err;
}

/**
 * True when an error was thrown because the user denied photo or camera
 * access. Callers use it to decide whether to show an "Open Settings"
 * Alert (the only path back when "Don't ask again" was selected).
 */
export function isPermissionDeniedError(e: unknown): boolean {
  return (e as any)?.code === PICKER_PERMISSION_DENIED;
}

function toPickedFile(asset: any, fallbackPrefix: string): PickedFile {
  // Library returns { path, mime, ... }; the legacy expo path returns
  // { uri, mimeType, fileName }. Normalise to one shape.
  const uri = asset.path || asset.uri;
  const mime = asset.mime || asset.mimeType || 'image/jpeg';
  const ext = mime.split('/').pop() || 'jpg';
  const name =
    asset.filename || asset.fileName || `${fallbackPrefix}_${Date.now()}.${ext}`;
  return { uri, name, type: mime };
}

/**
 * Open the camera, capture a photo, run the styled crop UI.
 * Resolves to `null` if the user cancels.
 */
export async function captureWithCrop(
  options: { namePrefix?: string } = {},
): Promise<PickedFile | null> {
  const namePrefix = options.namePrefix || 'photo';

  // In-app rationale before the OS prompt. Already-granted → no modal.
  // User declines rationale → treat as permission-denied so the
  // existing isPermissionDeniedError() branch fires the "open settings"
  // UI the caller already shows for an OS denial.
  const gate = await requestPermissionWithRationale('camera', cameraAsker);
  if (!gate.granted) throw makePermissionError('Camera access not granted');

  if (cropPickerAvailable && CropPicker) {
    try {
      const asset = await CropPicker.openCamera(CROP_OPTIONS);
      if (!asset) return null;
      return toPickedFile(asset, namePrefix);
    } catch (e: any) {
      // E_PICKER_CANCELLED → user backed out, treat as no-op.
      if (e?.code === 'E_PICKER_CANCELLED') return null;
      // Permission denial — surface a tagged error so the caller can
      // show an Open Settings prompt.
      if (e?.code === 'E_NO_LIBRARY_PERMISSION' || e?.code === 'E_NO_CAMERA_PERMISSION') {
        throw makePermissionError(e?.message);
      }
      // Any other rn-image-crop-picker error — propagate.
      // We deliberately DO NOT fall through to expo-image-picker:
      // expo's launchCameraAsync hits the "unregistered
      // ActivityResultLauncher" IllegalStateException on
      // aggressive-memory OEMs (Realme/Oppo/Vivo/Xiaomi) — which is
      // exactly the failure mode this wrapper was created to escape.
      // Failing visibly here lets the caller show a useful message.
      console.log('[cropPicker] camera failed (no fallback):', e?.message);
      throw e;
    }
  }

  // Reached ONLY when react-native-image-crop-picker isn't in the bundle
  // (older dev-client APK, web preview). Production builds always
  // include it, so this branch is a development safety net.
  const perm = await ExpoImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) throw makePermissionError('Camera access denied');
  const result: any = await ExpoImagePicker.launchCameraAsync({
    mediaTypes: 'images' as any,
    allowsEditing: true,
    quality: 0.85,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  return toPickedFile(result.assets[0], namePrefix);
}

/**
 * Open the gallery, pick a photo, run the styled crop UI.
 * Resolves to `null` if the user cancels.
 */
export async function pickWithCrop(
  options: { namePrefix?: string } = {},
): Promise<PickedFile | null> {
  const namePrefix = options.namePrefix || 'photo';

  // Mirrors captureWithCrop's gate — see comment there.
  const gate = await requestPermissionWithRationale('gallery', galleryAsker);
  if (!gate.granted) throw makePermissionError('Photo library access not granted');

  if (cropPickerAvailable && CropPicker) {
    try {
      const asset = await CropPicker.openPicker(CROP_OPTIONS);
      if (!asset) return null;
      return toPickedFile(asset, namePrefix);
    } catch (e: any) {
      if (e?.code === 'E_PICKER_CANCELLED') return null;
      if (e?.code === 'E_NO_LIBRARY_PERMISSION' || e?.code === 'E_NO_CAMERA_PERMISSION') {
        throw makePermissionError(e?.message);
      }
      // Same reasoning as captureWithCrop: do NOT fall through to
      // expo's launchImageLibraryAsync. Realme 11x and similar
      // aggressive-memory OEMs throw "unregistered
      // ActivityResultLauncher" the moment expo's launch is hit — the
      // exact crash this whole wrapper exists to avoid.
      console.log('[cropPicker] gallery failed (no fallback):', e?.message);
      throw e;
    }
  }

  // Skip requestMediaLibraryPermissionsAsync — Google Play 2024+ policy
  // forbids requesting READ_MEDIA_IMAGES for "infrequent" photo access
  // like ours. On Android 13+ launchImageLibraryAsync transparently uses
  // the system Photo Picker (which needs no permission); on older API
  // levels the OS falls back to the legacy gallery flow which doesn't
  // need the permission either when launched via SAF.
  const result: any = await ExpoImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images' as any,
    allowsEditing: true,
    quality: 0.85,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  return toPickedFile(result.assets[0], namePrefix);
}

/** True once the project has been rebuilt with the native module. */
export const isStyledCropAvailable = (): boolean => cropPickerAvailable;

/**
 * True when an error is the Android "unregistered ActivityResultLauncher"
 * failure. expo-image-picker / expo-document-picker throw this when the
 * host Activity was destroyed + recreated while the system picker was
 * open — common on aggressive-memory OEMs (Realme / Oppo / Vivo /
 * Xiaomi) and on any phone with the "Don't keep activities" developer
 * option enabled.
 *
 * Image picking routes through react-native-image-crop-picker, which is
 * immune (it uses the classic startActivityForResult path). Document
 * picking has no bundled native alternative, so its call sites use this
 * to detect the failure and steer the user to the Camera/Gallery flow,
 * which always works.
 */
export function isActivityLauncherError(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e ?? '');
  return /unregistered|ActivityResultLauncher|IllegalState/i.test(msg);
}
