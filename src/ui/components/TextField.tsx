import type { ComponentProps } from 'react';
import { StyleSheet } from 'react-native';
import { TextInput } from 'react-native-paper';

// Paper's TextInput narrows several RN props, so the surface is typed from Paper's own props;
// `editable` stays for call-site compatibility and maps onto Paper's `disabled`.
type Props = Omit<ComponentProps<typeof TextInput>, 'mode' | 'theme'> & { editable?: boolean };

/** Shared single-line/multiline text input. Replaces the duplicated `input` StyleSheet blocks. */
export function TextField({ style, multiline, editable, ...props }: Props) {
  return (
    <TextInput
      {...props}
      mode="outlined"
      dense
      multiline={multiline}
      disabled={editable === false}
      style={[styles.input, multiline && styles.multiline, style]}
    />
  );
}

const styles = StyleSheet.create({
  input: { flex: 1 },
  multiline: { minHeight: 96 },
});
