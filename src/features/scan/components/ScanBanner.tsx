import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ICONS } from '../../../ui/icons';
import { darkColors as d } from '../../../ui/theme';

export type ScanBannerState = {
  /** Re-arms the auto-hide timer even when the message repeats. */
  nonce: number;
  message: string;
  tone: 'success' | 'info';
  action?: { label: string; onPress: () => void };
};

const HIDE_AFTER_MS = 3000;

/**
 * Top-of-camera confirmation ("Lightning Bolt added · Undo"). Not the app toast: that sits at the bottom
 * where it would cover the capture gallery.
 */
export function ScanBanner({ banner, onHide }: { banner: ScanBannerState | null; onHide: () => void }) {
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(onHide, HIDE_AFTER_MS);
    return () => clearTimeout(t);
  }, [banner, onHide]);

  if (!banner) return null;
  const { action } = banner;

  return (
    <View style={styles.outer} pointerEvents="box-none">
      <View style={styles.banner}>
        <MaterialIcons
          name={banner.tone === 'success' ? ICONS.checkCircle : ICONS.layers}
          size={18}
          color={banner.tone === 'success' ? d.success : d.textMuted}
        />
        <Text style={styles.text} numberOfLines={1}>
          {banner.message}
        </Text>
        {action ? (
          <Pressable
            onPress={() => {
              action.onPress();
              onHide();
            }}
            hitSlop={8}
          >
            <Text style={styles.action}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { position: 'absolute', top: 12, left: 16, right: 16, alignItems: 'center' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(8,12,22,0.9)',
    maxWidth: '100%',
  },
  text: { color: d.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  action: { color: d.primary, fontSize: 14, fontWeight: '700', textTransform: 'uppercase' },
});
