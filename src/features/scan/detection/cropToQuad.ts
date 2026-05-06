import * as FileSystem from 'expo-file-system/legacy';
import {
  BorderTypes,
  ColorConversionCodes,
  DataTypes,
  DecompTypes,
  InterpolationFlags,
  ObjectType,
  OpenCV,
} from 'react-native-fast-opencv';
import type { FrameSize, Point, Quad } from './useCardDetection';
import { Sentry } from '../../../observability/breadcrumb';

const MTG_OUTPUT_WIDTH = 750;
const MTG_OUTPUT_HEIGHT = 1050;

export type CropResult = {
  uri: string;
  width: number;
  height: number;
};

/**
 * Perspective-correct a captured still to the detected card quad.
 *
 * `quad` is in frame-processor coordinates; `frameSize` is the size of the
 * camera frame the quad was detected on. The still at `photoUri` may be a
 * different resolution — we scale the quad uniformly to map it onto the still.
 *
 * Output is a JPEG of `MTG_OUTPUT_WIDTH x MTG_OUTPUT_HEIGHT` written to the
 * cache directory and returned as a `file://` URI ready for multipart upload.
 */
export async function cropToQuad(args: {
  photoUri: string;
  photoWidth: number;
  photoHeight: number;
  quad: Quad;
  frameSize: FrameSize;
  jpegQuality: number;
}): Promise<CropResult> {
  return Sentry.startSpan(
    {
      name: 'cropToQuad',
      op: 'image.process',
      attributes: {
        'photo.width': args.photoWidth,
        'photo.height': args.photoHeight,
        'frame.width': args.frameSize.width,
        'frame.height': args.frameSize.height,
        'jpeg.quality': args.jpegQuality,
      },
    },
    () => cropToQuadInner(args),
  );
}

async function cropToQuadInner(args: {
  photoUri: string;
  photoWidth: number;
  photoHeight: number;
  quad: Quad;
  frameSize: FrameSize;
  jpegQuality: number;
}): Promise<CropResult> {
  const { photoUri, photoWidth, photoHeight, quad, frameSize, jpegQuality } = args;

  // Frame and photo can have *different* aspect ratios (e.g. frame 1280x720 = 16:9,
  // photo 4000x3000 = 4:3). The Camera HAL center-crops the larger-aspect output
  // to fit the smaller-aspect output, so a uniform per-axis scale is wrong: it
  // would map quad coords to a region that's stretched and offset wrong.
  // Compute a single uniform scale + offset that maps the frame's visible area
  // into the photo, with the cropped axis centered.
  const photoAspect = photoWidth / photoHeight;
  const frameAspect = frameSize.width / frameSize.height;
  let uniformScale: number;
  let offsetX = 0;
  let offsetY = 0;
  if (frameAspect > photoAspect) {
    // Frame is wider than photo (e.g. 16:9 frame from 4:3 photo). Frame's x
    // range covers the full photo width; the photo's top + bottom are cropped
    // out of the frame view. So scaleX === scaleY === photoWidth/frameWidth,
    // and an offsetY centers the visible band vertically in the photo.
    uniformScale = photoWidth / frameSize.width;
    const visibleHeight = frameSize.height * uniformScale;
    offsetY = (photoHeight - visibleHeight) / 2;
  } else {
    // Frame is taller than photo (rare on phones but possible). Frame's y
    // range covers the full photo height; the photo's left + right edges are
    // cropped. Center the visible band horizontally.
    uniformScale = photoHeight / frameSize.height;
    const visibleWidth = frameSize.width * uniformScale;
    offsetX = (photoWidth - visibleWidth) / 2;
  }
  const photoQuad: Quad = [
    { x: quad[0].x * uniformScale + offsetX, y: quad[0].y * uniformScale + offsetY },
    { x: quad[1].x * uniformScale + offsetX, y: quad[1].y * uniformScale + offsetY },
    { x: quad[2].x * uniformScale + offsetX, y: quad[2].y * uniformScale + offsetY },
    { x: quad[3].x * uniformScale + offsetX, y: quad[3].y * uniformScale + offsetY },
  ];

  const base64 = await FileSystem.readAsStringAsync(photoUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const src = OpenCV.base64ToMat(base64);

  // OpenCV decodes JPEG into BGR; convert to RGB so warped output is correct
  // when re-encoded back to JPEG.
  const rgb = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
  OpenCV.invoke('cvtColor', src, rgb, ColorConversionCodes.COLOR_BGR2RGB);

  const srcPts = pointsToPointVector(photoQuad);
  const dstPts = pointsToPointVector(targetRect(MTG_OUTPUT_WIDTH, MTG_OUTPUT_HEIGHT));
  const M = OpenCV.invoke('getPerspectiveTransform', srcPts, dstPts, DecompTypes.DECOMP_LU);

  const outSize = OpenCV.createObject(ObjectType.Size, MTG_OUTPUT_WIDTH, MTG_OUTPUT_HEIGHT);
  const warped = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
  const borderValue = OpenCV.createObject(ObjectType.Scalar, 0, 0, 0);
  OpenCV.invoke(
    'warpPerspective',
    rgb,
    warped,
    M,
    outSize,
    InterpolationFlags.INTER_LINEAR,
    BorderTypes.BORDER_CONSTANT,
    borderValue,
  );

  // Convert back to BGR before saving so the on-disk JPEG colors are correct.
  const bgr = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
  OpenCV.invoke('cvtColor', warped, bgr, ColorConversionCodes.COLOR_RGB2BGR);

  const cacheDir = FileSystem.cacheDirectory ?? '';
  const fileName = `lupira-scan-${Date.now()}.jpg`;
  const cacheUri = cacheDir.endsWith('/') ? `${cacheDir}${fileName}` : `${cacheDir}/${fileName}`;
  const diskPath = cacheUri.replace(/^file:\/\//, '');

  const compression = clamp01(jpegQuality / 100);
  OpenCV.saveMatToFile(bgr, diskPath, 'jpeg', compression);

  OpenCV.clearBuffers();

  return {
    uri: cacheUri,
    width: MTG_OUTPUT_WIDTH,
    height: MTG_OUTPUT_HEIGHT,
  };
}

function pointsToPointVector(points: Point[]) {
  const point2fs = points.map((p) => OpenCV.createObject(ObjectType.Point2f, p.x, p.y));
  return OpenCV.createObject(ObjectType.Point2fVector, point2fs);
}

function targetRect(w: number, h: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: w - 1, y: 0 },
    { x: w - 1, y: h - 1 },
    { x: 0, y: h - 1 },
  ];
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
