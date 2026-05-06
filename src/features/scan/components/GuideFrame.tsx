import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import { GUIDE_SHORT_FRACTION } from '../detection/useCardDetection';

const ACCENT = 'rgba(255,255,255,0.7)';
const ACCENT_DIM = 'rgba(255,255,255,0.25)';
const MTG_ASPECT_PORTRAIT = 2.5 / 3.5;

type Props = {
  containerWidth: number;
  containerHeight: number;
};

/**
 * Always-visible portrait MTG-card guide rectangle drawn on top of the camera
 * preview. The worklet's detection ROI mirrors these proportions, so when the
 * user lines up the card with this guide on screen, edge detection runs only
 * inside that region — no noise from desk/hand/shadows outside the card.
 *
 * Companion to the `GUIDE_SHORT_FRACTION` constant in useCardDetection.ts.
 */
export function GuideFrame({ containerWidth, containerHeight }: Props) {
  if (containerWidth === 0 || containerHeight === 0) return null;

  // Display container is portrait (taller than wide). Pick the largest
  // portrait MTG-aspect rect that fits inside `GUIDE_SHORT_FRACTION` of
  // either axis — same logic the worklet uses on the buffer side, just on
  // a portrait container instead of a landscape buffer.
  let guideHeight = containerHeight * GUIDE_SHORT_FRACTION;
  let guideWidth = guideHeight * MTG_ASPECT_PORTRAIT;
  if (guideWidth > containerWidth * GUIDE_SHORT_FRACTION) {
    guideWidth = containerWidth * GUIDE_SHORT_FRACTION;
    guideHeight = guideWidth / MTG_ASPECT_PORTRAIT;
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
