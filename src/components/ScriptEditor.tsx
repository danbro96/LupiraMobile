import { StyleSheet, TextInput } from 'react-native';

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  editable?: boolean;
};

export function ScriptEditor({ value, onChange, placeholder, editable = true }: Props) {
  return (
    <TextInput
      style={styles.input}
      multiline
      autoCapitalize="sentences"
      autoCorrect
      placeholder={placeholder ?? 'Type a sentence to hear it spoken…'}
      value={value}
      onChangeText={onChange}
      editable={editable}
      textAlignVertical="top"
      scrollEnabled
    />
  );
}

const styles = StyleSheet.create({
  input: {
    flex: 1,
    fontSize: 17,
    lineHeight: 24,
    padding: 16,
    color: '#111',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    minHeight: 200,
  },
});
