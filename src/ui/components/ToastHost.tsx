import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Snackbar } from 'react-native-paper';
import { useToast } from '../../feedback/toast';

// The imperative toast API + store live in feedback/toast (a cross-cutting leaf, so non-UI layers
// can call `toast()` without importing the UI). This file is just the visual host.

/** Mount once near the app root (inside SafeAreaProvider). Renders the current toast, if any. */
export function ToastHost() {
  const message = useToast(s => s.message);
  const action = useToast(s => s.action);
  const durationMs = useToast(s => s.durationMs);
  const nonce = useToast(s => s.nonce);
  const hide = useToast(s => s.hide);
  const insets = useSafeAreaInsets();

  return (
    // Keyed by nonce so an identical repeat message remounts and re-arms Snackbar's own timer.
    <Snackbar
      key={nonce}
      visible={!!message}
      onDismiss={hide}
      duration={durationMs}
      action={action ? { label: action.label, onPress: action.onPress } : undefined}
      wrapperStyle={{ bottom: insets.bottom + 24 }}
    >
      {message}
    </Snackbar>
  );
}
