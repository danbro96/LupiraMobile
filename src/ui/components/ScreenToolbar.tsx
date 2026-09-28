import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/** A screen's own controls, in a row under the navigator's header — never instead of it. Search
 *  fields, period navigators and filters live here; navigation chrome stays with the header. */
export function ScreenToolbar({ children }: { children: ReactNode }) {
  return <View style={styles.toolbar}>{children}</View>;
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, gap: 8 },
});
