import { useMemo } from 'react';
import { createSynchronizable, type Synchronizable } from 'react-native-worklets';

/**
 * Bridge between the old `useSharedValue` ergonomics from worklets-core and the
 * new Software Mansion `react-native-worklets` `Synchronizable` model.
 *
 * Returns a `Synchronizable<T>` whose:
 * - JS-thread reads use `.getDirty()` (fast, may be slightly stale).
 * - Worklet-thread reads use `.getDirty()` (also OK; getBlocking is for cross-runtime
 *   strict reads, not needed for our single-camera-thread + JS-thread pattern).
 * - Writes use `.setBlocking(value)`.
 *
 * Created lazily via useMemo so the underlying native object survives re-renders.
 */
export function useSyncedValue<T>(initial: T): Synchronizable<T> {
  return useMemo(() => createSynchronizable<T>(initial), []);
}
