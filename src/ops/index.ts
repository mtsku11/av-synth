// Registers every available operator. Imported once from main.ts.

import { registerOp } from '../core/operators';
import { feedbackDef } from './feedback';
import { timeDisplaceDef } from './timeDisplace';
import { slitScanDef } from './slitScan';
import { dataMoshDef } from './dataMosh';
import { pixelSortDef } from './pixelSort';
import { fieldSortDef } from './fieldSort';
import { structureDef } from './structure';
import { flowDef } from './flow';
import { vortexDef } from './vortex';
import { vortexPacketDef } from './vortexPacket';
import { curlNoiseDef } from './curlNoise';
import { saddleFieldDef } from './saddleField';
import { pinchBulgeDef } from './pinchBulge';
import { polarRippleDef } from './polarRipple';
import { sinkSourceFieldDef } from './sinkSourceField';
import { spiralFieldDef } from './spiralField';
import { domainFoldDef } from './domainFold';
import { gyreFieldDef } from './gyreField';
import { turbulenceWarpDef } from './turbulenceWarp';
import { magneticDipoleDef } from './magneticDipole';
import { aDef, bDef, gDef, rDef } from './channel';
import { grainDef } from './grain';
import { modulateDef } from './modulate';
import { modulateDisplaceDef } from './modulateDisplace';
import { modulateHueDef } from './modulateHue';
import { modulateHueRoutedDef } from './modulateHueRouted';
import { modulateKaleidDef } from './modulateKaleid';
import { modulatePixelateDef } from './modulatePixelate';
import { modulatePixelateRoutedDef } from './modulatePixelateRouted';
import { modulateRotateDef } from './modulateRotate';
import { modulateRotateRoutedDef } from './modulateRotateRouted';
import { modulateRoutedDef } from './modulateRouted';
import { modulateRepeatDef } from './modulateRepeat';
import { modulateRepeatRoutedDef } from './modulateRepeatRouted';
import { modulateScaleDef } from './modulateScale';
import { modulateScaleRoutedDef } from './modulateScaleRouted';
import { modulateScrollXDef } from './modulateScrollX';
import { modulateScrollYDef } from './modulateScrollY';
import { modulateScrollYRoutedDef } from './modulateScrollYRouted';
import { selfModDef } from './selfMod';
import { scaleDef } from './scale';
import { rotateDef } from './rotate';
import { scrollXDef } from './scrollX';
import { scrollYDef } from './scrollY';
import { repeatDef } from './repeat';
import { repeatXDef } from './repeatX';
import { repeatYDef } from './repeatY';
import { pixelateDef } from './pixelate';
import { kaleidDef } from './kaleid';
import { chromaShiftDef } from './chromaShift';
import { brightnessDef } from './brightness';
import { contrastDef } from './contrast';
import { colorDef } from './color';
import { saturateDef } from './saturate';
import { posterizeDef } from './posterize';
import { invertDef } from './invert';
import { lumaDef } from './luma';
import { threshDef } from './thresh';
import { hueDef } from './hue';
import { coloramaDef } from './colorama';
import { addDef, blendDef, diffDef, layerDef, maskDef, multDef, subDef } from './blend';
import { sumDef } from './sum';
import { sourceBlendDef } from './sourceBlend';

let registered = false;

export function registerAllOps(): void {
  if (registered) return;
  registered = true;
  registerOp(feedbackDef);
  registerOp(timeDisplaceDef);
  registerOp(slitScanDef);
  registerOp(structureDef);
  registerOp(flowDef);
  registerOp(dataMoshDef);
  registerOp(pixelSortDef);
  registerOp(fieldSortDef);
  registerOp(vortexDef);
  registerOp(vortexPacketDef);
  registerOp(curlNoiseDef);
  registerOp(saddleFieldDef);
  registerOp(pinchBulgeDef);
  registerOp(polarRippleDef);
  registerOp(sinkSourceFieldDef);
  registerOp(spiralFieldDef);
  registerOp(domainFoldDef);
  registerOp(gyreFieldDef);
  registerOp(turbulenceWarpDef);
  registerOp(magneticDipoleDef);
  registerOp(rDef);
  registerOp(gDef);
  registerOp(bDef);
  registerOp(aDef);
  registerOp(grainDef);
  registerOp(modulateDef);
  registerOp(modulateRoutedDef);
  registerOp(modulateDisplaceDef);
  registerOp(modulateRotateDef);
  registerOp(modulateRotateRoutedDef);
  registerOp(modulateScaleDef);
  registerOp(modulateScaleRoutedDef);
  registerOp(modulatePixelateDef);
  registerOp(modulatePixelateRoutedDef);
  registerOp(modulateRepeatDef);
  registerOp(modulateRepeatRoutedDef);
  registerOp(modulateScrollXDef);
  registerOp(modulateScrollYDef);
  registerOp(modulateKaleidDef);
  registerOp(modulateHueDef);
  registerOp(modulateScrollYRoutedDef);
  registerOp(modulateHueRoutedDef);
  registerOp(selfModDef);
  registerOp(scaleDef);
  registerOp(rotateDef);
  registerOp(scrollXDef);
  registerOp(scrollYDef);
  registerOp(repeatDef);
  registerOp(repeatXDef);
  registerOp(repeatYDef);
  registerOp(pixelateDef);
  registerOp(kaleidDef);
  registerOp(chromaShiftDef);
  registerOp(brightnessDef);
  registerOp(contrastDef);
  registerOp(colorDef);
  registerOp(saturateDef);
  registerOp(posterizeDef);
  registerOp(invertDef);
  registerOp(lumaDef);
  registerOp(threshDef);
  registerOp(hueDef);
  registerOp(coloramaDef);
  registerOp(sumDef);
  registerOp(addDef);
  registerOp(subDef);
  registerOp(multDef);
  registerOp(diffDef);
  registerOp(layerDef);
  registerOp(blendDef);
  registerOp(maskDef);
  registerOp(sourceBlendDef);
}

// Chain order matches the typical Hydra source-→-geometry-→-color flow,
// with feedback first (mixes against the prev-frame texture) and modulate
// next so its UV warp acts on every geometry op downstream. Geometry ops
// are ordered conservatively (continuous transforms first, then tiling,
// then pixel quantisation) so each subsequent op sees the post-warped grid.
export const DEFAULT_CHAIN: readonly string[] = [
  'feedback',
  'timeDisplace',
  'slitScan',
  'structure',
  'flow',
  'dataMosh',
  'pixelSort',
  'fieldSort',
  'vortex',
  'vortexPacket',
  'curlNoise',
  'saddleField',
  'pinchBulge',
  'polarRipple',
  'sinkSourceField',
  'spiralField',
  'domainFold',
  'gyreField',
  'turbulenceWarp',
  'magneticDipole',
  'r',
  'g',
  'b',
  'a',
  'grain',
  'modulate',
  'modulateRouted',
  'modulateDisplace',
  'modulateScale',
  'modulateScaleRouted',
  'modulatePixelate',
  'modulatePixelateRouted',
  'modulateRepeat',
  'modulateRepeatRouted',
  'selfMod',
  'scale',
  'rotate',
  'modulateRotate',
  'modulateRotateRouted',
  'modulateScrollX',
  'modulateScrollY',
  'modulateScrollYRouted',
  'scrollX',
  'scrollY',
  'repeat',
  'repeatX',
  'repeatY',
  'pixelate',
  'modulateKaleid',
  'kaleid',
  'chromaShift',
  'brightness',
  'contrast',
  'color',
  'saturate',
  'posterize',
  'invert',
  'luma',
  'thresh',
  'modulateHue',
  'modulateHueRouted',
  'hue',
  'colorama',
  'sourceBlend',
];
