import * as Haptics from 'expo-haptics';

// Reserved for meaningful moments, not every tap. Each no-ops where the platform can't vibrate.
// A leaf module (expo-haptics only), so any layer may call it.

export function hapticSuccess(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function hapticError(): void {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}

export function hapticSelection(): void {
  void Haptics.selectionAsync().catch(() => {});
}

/** Physical "thunk" — picking up a row to reorder, or committing a delete. */
export function hapticImpact(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Medium): void {
  void Haptics.impactAsync(style).catch(() => {});
}
