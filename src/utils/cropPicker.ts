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

  if (cropPickerAvailable && CropPicker) {
    try {
      const asset = await CropPicker.openCamera(CROP_OPTIONS);
      if (!asset) return null;
      return toPickedFile(asset, namePrefix);
    } catch (e: any) {
      // E_PICKER_CANCELLED → user backed out. Anything else → swallow
      // and try the expo fallback so the app still works on devices
      // where the native module misbehaves.
      if (e?.code === 'E_PICKER_CANCELLED') return null;
      console.log('[cropPicker] camera failed, falling back to expo:', e?.message);
    }
  }

  // Fallback path — expo-image-picker. No crop UI but at least the
  // upload still works on older APKs.
  const perm = await ExpoImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
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

  if (cropPickerAvailable && CropPicker) {
    try {
      const asset = await CropPicker.openPicker(CROP_OPTIONS);
      if (!asset) return null;
      return toPickedFile(asset, namePrefix);
    } catch (e: any) {
      if (e?.code === 'E_PICKER_CANCELLED') return null;
      console.log('[cropPicker] gallery failed, falling back to expo:', e?.message);
    }
  }

  const perm = await ExpoImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
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
