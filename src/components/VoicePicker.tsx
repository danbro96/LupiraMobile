import { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { OptionsResponse, Voice } from '../api/types';
import { optionsUrlFromWs } from '../config';

type Props = {
  apiUrl: string;
  apiKey: string;
  selected: string;
  onSelect: (voice: string) => void;
};

export function VoicePicker({ apiUrl, apiKey, selected, onSelect }: Props) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!apiUrl || !apiKey) return;
    const controller = new AbortController();
    fetch(optionsUrlFromWs(apiUrl), {
      headers: { 'X-API-Key': apiKey },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as OptionsResponse;
        setVoices(json.voices ?? []);
        setLoadError(null);
      })
      .catch((e) => {
        if (e.name !== 'AbortError') setLoadError(String(e?.message ?? e));
      });
    return () => controller.abort();
  }, [apiUrl, apiKey]);

  const selectedVoice = useMemo(
    () => voices.find((v) => v.id === selected),
    [voices, selected]
  );

  return (
    <View>
      <Pressable style={styles.trigger} onPress={() => setOpen(true)}>
        <Text style={styles.triggerLabel}>Voice</Text>
        <Text style={styles.triggerValue} numberOfLines={1}>
          {selectedVoice
            ? `${selectedVoice.name} — ${selectedVoice.language}, ${selectedVoice.gender}`
            : selected}
        </Text>
      </Pressable>
      <Modal
        visible={open}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setOpen(false)}
      >
        <SafeAreaView style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Pick a voice</Text>
            <Pressable onPress={() => setOpen(false)}>
              <Text style={styles.modalDone}>Done</Text>
            </Pressable>
          </View>
          {loadError ? (
            <Text style={styles.error}>Could not load voices: {loadError}</Text>
          ) : null}
          <FlatList
            data={voices}
            keyExtractor={(v) => v.id}
            renderItem={({ item }) => (
              <Pressable
                style={[styles.row, item.id === selected && styles.rowSelected]}
                onPress={() => {
                  onSelect(item.id);
                  setOpen(false);
                }}
              >
                <Text style={styles.rowName}>{item.name}</Text>
                <Text style={styles.rowMeta}>
                  {item.language} · {item.gender} · {item.id}
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={
              loadError ? null : <Text style={styles.empty}>Loading voices…</Text>
            }
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#f5f5f7',
    borderRadius: 10,
  },
  triggerLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 2,
  },
  triggerValue: {
    fontSize: 15,
    color: '#111',
  },
  modalRoot: {
    flex: 1,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
  },
  modalDone: {
    fontSize: 16,
    color: '#0a84ff',
    fontWeight: '600',
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  rowSelected: {
    backgroundColor: '#eaf3ff',
  },
  rowName: {
    fontSize: 16,
    color: '#111',
  },
  rowMeta: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  empty: {
    padding: 24,
    color: '#666',
    textAlign: 'center',
  },
  error: {
    padding: 16,
    color: '#b00020',
  },
});
