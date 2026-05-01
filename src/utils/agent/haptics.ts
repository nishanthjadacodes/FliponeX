import * as Haptics from 'expo-haptics';

// Centralized haptic feedback. Fire-and-forget; failures swallowed.
export const tap = (): void => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};
export const press = (): void => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
};
export const heavy = (): void => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
};
export const success = (): void => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
};
export const warning = (): void => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
};
export const error = (): void => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
};
export const selection = (): void => {
  Haptics.selectionAsync().catch(() => {});
};

export default { tap, press, heavy, success, warning, error, selection };
