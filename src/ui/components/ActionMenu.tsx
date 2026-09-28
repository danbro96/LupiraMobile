import { Fragment, useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { Button, Divider, List, Modal, Portal } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radii, spacing, useColors, type Palette } from '../theme';
import { ICONS } from '../icons';

export interface ActionItem {
  label: string;
  destructive?: boolean;
  /** Show a trailing checkmark (e.g. the current choice in a picker). */
  selected?: boolean;
  onPress: () => void;
}

/** Bottom action sheet (Modal-based) — a cross-platform menu that, unlike Android's Alert,
 *  isn't capped at 3 buttons. Tapping an action closes the sheet then runs it. */
export function ActionMenu({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title?: string;
  actions: ActionItem[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const c = useColors();
  const styles = useMemo(() => makeStyles(c), [c]);
  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onClose}
        style={styles.wrapper}
        contentContainerStyle={[styles.sheet, { paddingBottom: insets.bottom + spacing.sm }]}
      >
        {title ? <List.Subheader numberOfLines={1}>{title}</List.Subheader> : null}
        {actions.map((a, i) => (
          <Fragment key={a.label}>
            {i > 0 ? <Divider /> : null}
            <List.Item
              title={a.label}
              titleNumberOfLines={1}
              titleStyle={{ color: a.destructive ? c.danger : c.primary }}
              right={a.selected ? props => <List.Icon {...props} icon={ICONS.check} color={c.primary} /> : undefined}
              onPress={() => {
                onClose();
                a.onPress();
              }}
              accessibilityState={{ selected: a.selected }}
            />
          </Fragment>
        ))}
        <Button mode="contained-tonal" onPress={onClose} style={styles.cancel}>
          Cancel
        </Button>
      </Modal>
    </Portal>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrapper: { justifyContent: 'flex-end', marginBottom: 0 },
    sheet: {
      backgroundColor: c.bg,
      borderTopLeftRadius: radii.lg,
      borderTopRightRadius: radii.lg,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
    },
    cancel: { marginTop: spacing.sm },
  });
