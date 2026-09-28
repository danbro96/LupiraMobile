import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { GUIDE_SHORT_FRACTION, MTG_ASPECT } from '../detection/useCardDetection';

const ACCENT = 'rgba(255,255,255,0.7)';
const ACCENT_DIM = 'rgba(255,255,255,0.25)';

type Props = {
  containerWidth: number;
  containerHeight: number;
  /** Bumped on every capture; each change flashes the guide as a shutter cue. */
  flashKey: number;
};

/**
 * Always-visible portrait MTG-card guide rectangle over the camera preview. The worklet's detection ROI
 * mirrors these proportions, so lining the card up with the guide confines edge detection to that region —
 * no noise from desk, hand or shadows outside the card. Companion to `GUIDE_SHORT_FRACTION` in
 * useCardDetection.ts.
 */
export function GuideFrame({ containerWidth, containerHeight, flashKey }: Props) {
  const flash = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (flashKey === 0) return;
    flash.setValue(1);
    Animated.timing(flash, { toValue: 0, duration: 450, useNativeDriver: true }).start();
  }, [flashKey, flash]);

  if (containerWidth === 0 || containerHeight === 0) return null;

  // Display container is portrait (taller than wide). Pick the largest
  // portrait MTG-aspect rect that fits inside `GUIDE_SHORT_FRACTION` of
  // either axis — same logic the worklet uses on the buffer side, just on
  // a portrait container instead of a landscape buffer.
  let guideHeight = containerHeight * GUIDE_SHORT_FRACTION;
  let guideWidth = guideHeight * MTG_ASPECT;
  if (guideWidth > containerWidth * GUIDE_SHORT_FRACTION) {
    guideWidth = containerWidth * GUIDE_SHORT_FRACTION;
    guideHeight = guideWidth / MTG_ASPECT;
  }
  const x = (containerWidth - guideWidth) / 2;
  const y = (containerHeight - guideHeight) / 2;
  const cornerLen = Math.min(guideWidth, guideHeight) * 0.08;

  return (
    <View style={[styles.container, { width: containerWidth, height: containerHeight }]} pointerEvents="none">
      <Svg width={containerWidth} height={containerHeight}>
        {/* Faint full rectangle so users always see the bounds. */}
        <Rect
          x={x}
          y={y}
          width={guideWidth}
          height={guideHeight}
          stroke={ACCENT_DIM}
          strokeWidth={1.5}
          fill="none"
          strokeDasharray="6 4"
        />
        {/* Brighter L-shaped corners to anchor the eye. */}
        {/* Top-left */}
        <Line x1={x} y1={y} x2={x + cornerLen} y2={y} stroke={ACCENT} strokeWidth={3} />
        <Line x1={x} y1={y} x2={x} y2={y + cornerLen} stroke={ACCENT} strokeWidth={3} />
        {/* Top-right */}
        <Line x1={x + guideWidth - cornerLen} y1={y} x2={x + guideWidth} y2={y} stroke={ACCENT} strokeWidth={3} />
        <Line x1={x + guideWidth} y1={y} x2={x + guideWidth} y2={y + cornerLen} stroke={ACCENT} strokeWidth={3} />
        {/* Bottom-left */}
        <Line x1={x} y1={y + guideHeight - cornerLen} x2={x} y2={y + guideHeight} stroke={ACCENT} strokeWidth={3} />
        <Line x1={x} y1={y + guideHeight} x2={x + cornerLen} y2={y + guideHeight} stroke={ACCENT} strokeWidth={3} />
        {/* Bottom-right */}
        <Line x1={x + guideWidth - cornerLen} y1={y + guideHeight} x2={x + guideWidth} y2={y + guideHeight} stroke={ACCENT} strokeWidth={3} />
        <Line x1={x + guideWidth} y1={y + guideHeight - cornerLen} x2={x + guideWidth} y2={y + guideHeight} stroke={ACCENT} strokeWidth={3} />
      </Svg>
      <Animated.View
        style={[styles.flash, { left: x, top: y, width: guideWidth, height: guideHeight, opacity: flash }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  flash: {
    position: 'absolute',
    borderWidth: 4,
    borderColor: '#fff',
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
});
