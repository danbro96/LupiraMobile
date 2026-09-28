import { describe, expect, it } from 'vitest';
import glyphMap from '@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialIcons.json';
import { ICONS } from './icons';

// Paper resolves `icon` strings at render time, so a name MaterialIcons does not know renders
// nothing and only warns in the console — it is not a build error. This is the build error.
describe('ICONS', () => {
  it('every concept maps to a real MaterialIcons glyph', () => {
    const unknown = Object.entries(ICONS).filter(([, glyph]) => !(glyph in glyphMap));
    expect(unknown).toEqual([]);
  });
});
