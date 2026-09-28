import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Button, Dialog, Portal, Text } from 'react-native-paper';
import { useColors } from '../theme';

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>(() => Promise.resolve(false));

/** Promise-based confirm over a Paper Dialog; replaces two-button Alert.alert flows. */
export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmDialogHost({ children }: { children: ReactNode }) {
  const c = useColors();
  const [opts, setOpts] = useState<ConfirmOptions>({ title: '' });
  const [visible, setVisible] = useState(false);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o);
    setVisible(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  // Keeps the last opts so the dialog still has content while it fades out.
  const settle = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setVisible(false);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Portal>
        {/* Paper clones the Dialog's first child to inject the title's top margin — a wrapping
            fragment would absorb it, so Title/Content/Actions must be direct siblings. */}
        <Dialog visible={visible} onDismiss={() => settle(false)}>
          <Dialog.Title>{opts.title}</Dialog.Title>
          {opts.message ? (
            <Dialog.Content>
              <Text variant="bodyMedium">{opts.message}</Text>
            </Dialog.Content>
          ) : null}
          <Dialog.Actions>
            <Button onPress={() => settle(false)}>{opts.cancelLabel ?? 'Cancel'}</Button>
            <Button textColor={opts.destructive ? c.danger : undefined} onPress={() => settle(true)}>
              {opts.confirmLabel ?? 'OK'}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </ConfirmContext.Provider>
  );
}
