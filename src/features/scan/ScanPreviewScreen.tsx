import React, { useLayoutEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScanStackParamList } from '../../navigation/types';
import { Icon } from '../../components/Icon';
import { colors, font, radius, spacing } from '../../components/theme';

type Nav = NativeStackNavigationProp<ScanStackParamList, 'ScanPreview'>;
type Route = RouteProp<ScanStackParamList, 'ScanPreview'>;

/**
 * Debug-only step between capture and upload. Shown when
 * `scanSettings.previewBeforeUpload` is on. Lets the user reject a bad
 * crop without burning a backend round-trip.
 *
 * Flow: ScanScreen captures → navigate('ScanPreview', { uri, cropped, originalUri })
 *       → user taps Send → navigate('Scan', { pendingUpload: { uri, cropped } })
 *       → ScanScreen sees the param and fires the scan mutation as today.
 */
export function ScanPreviewScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { uri, cropped, originalUri, sourceWidth, sourceHeight } = route.params;
  const [showRaw, setShowRaw] = useState(false);
  const displayedUri = showRaw ? originalUri : uri;

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Preview' });
  }, [navigation]);

  const onSend = () => {
    navigation.navigate('Scan', { pendingUpload: { uri, cropped, sourceWidth, sourceHeight } });
  };

  const onRetake = () => {
    navigation.goBack();
  };

  const canToggleRaw = originalUri !== uri;

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.imageWrap}>
        <Image source={{ uri: displayedUri }} style={styles.image} resizeMode="contain" />
      </View>

      <View style={styles.metaRow}>
        <View style={[styles.chip, { backgroundColor: cropped ? '#16331f' : '#33231a', borderColor: cropped ? colors.success : colors.warning }]}>
          <Icon name={cropped ? 'crop' : 'image-outline'} size={14} color={cropped ? 'success' : 'warning'} />
          <Text style={[styles.chipText, { color: cropped ? colors.success : colors.warning }]}>
            {cropped ? 'cropped' : 'raw frame'}
          </Text>
        </View>

        {canToggleRaw ? (
          <Pressable onPress={() => setShowRaw((v) => !v)} hitSlop={8}>
            <Text style={styles.toggleText}>
              {showRaw ? 'Show cropped image' : 'Inspect raw frame'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable onPress={onRetake} style={styles.secondaryButton}>
          <Icon name="arrow-undo-outline" size={18} color="primary" />
          <Text style={styles.secondaryButtonText}>Retake</Text>
        </Pressable>
        <Pressable onPress={onSend} style={styles.primaryButton}>
          <Icon name="send" size={18} color="white" />
          <Text style={styles.primaryButtonText}>Send</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  imageWrap: {
    flex: 1,
    margin: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  image: { flex: 1 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipText: { fontSize: font.small, fontWeight: '600', letterSpacing: 0.5 },
  toggleText: { color: colors.primary, fontSize: font.small, fontWeight: '500' },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 14,
  },
  secondaryButtonText: { color: colors.primary, fontSize: font.title, fontWeight: '600' },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
  },
  primaryButtonText: { color: '#fff', fontSize: font.title, fontWeight: '700' },
});
