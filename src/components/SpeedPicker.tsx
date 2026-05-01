import { Pressable, StyleSheet, Text, View } from 'react-native';

const STEPS = [0.75, 1.0, 1.25, 1.5];

type Props = {
  value: number;
  onChange: (speed: number) => void;
};

export function SpeedPicker({ value, onChange }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Speed</Text>
      <View style={styles.row}>
        {STEPS.map((step) => {
          const selected = Math.abs(step - value) < 0.01;
          return (
            <Pressable
              key={step}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => onChange(step)}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                {step.toFixed(2)}x
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#f5f5f7',
    borderRadius: 10,
  },
  label: {
    fontSize: 12,
    color: '#666',
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    alignItems: 'center',
  },
  chipSelected: {
    backgroundColor: '#0a84ff',
    borderColor: '#0a84ff',
  },
  chipText: {
    fontSize: 14,
    color: '#111',
    fontWeight: '500',
  },
  chipTextSelected: {
    color: '#fff',
  },
});
