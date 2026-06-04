// Registers every available operator. Imported once from main.ts.

import { registerOp } from '../core/operators';
import { feedbackDef } from './feedback';
import { slitScanDef } from './slitScan';
import { glyphRenderDef } from './glyphRender';
import { glyphMotionDef } from './glyphMotion';
import { matrixRainDef } from './matrixRain';
import { dataMoshDef } from './dataMosh';
import { acidFeedbackDef } from './acidFeedback';
import { flowMoshDef } from './flowMosh';
import { pixelSortDef } from './pixelSort';
import { fieldSortDef } from './fieldSort';
import { structureDef } from './structure';
import { flowDef } from './flow';
import { vortexDef } from './vortex';
import { vortexPacketDef } from './vortexPacket';
import { curlNoiseDef } from './curlNoise';
import { saddleFieldDef } from './saddleField';
import { warpDef } from './warp';
import { polarRippleDef } from './polarRipple';
import { fluidSimDef } from './fluidSim';
import { spiralFieldDef } from './spiralField';
import { domainFoldDef } from './domainFold';
import { gyreFieldDef } from './gyreField';
import { turbulenceWarpDef } from './turbulenceWarp';
import { voidEaterDef } from './voidEater';
import { magneticDipoleDef } from './magneticDipole';
import { channelDef } from './channel';
import { grainDef } from './grain';
import { modulateDef } from './modulate';
import { modulateDisplaceDef } from './modulateDisplace';
import { modulateHueDef } from './modulateHue';
import { modulateKaleidDef } from './modulateKaleid';
import { modulatePixelateDef } from './modulatePixelate';
import { modulateRotateDef } from './modulateRotate';
import { modulateRepeatDef } from './modulateRepeat';
import { modulateScaleDef } from './modulateScale';
import { modulateScrollXDef } from './modulateScrollX';
import { modulateScrollYDef } from './modulateScrollY';
import { selfModDef } from './selfMod';
import { scaleDef } from './scale';
import { rotateDef } from './rotate';
import { scrollDef } from './scroll';
import { repeatDef } from './repeat';
import { pixelateDef } from './pixelate';
import { kaleidDef } from './kaleid';
import { glitchDef } from './glitch';
import { gradeDef } from './grade';
import { colorDef } from './color';
import { posterizeDef } from './posterize';
import { extractDef } from './extract';
import { coloramaDef } from './colorama';
import { filmGradeDef } from './filmGrade';
import { clarityDef } from './clarity';
import { gradeLUTDef } from './gradeLUT';
import { debandDitherDef } from './debandDither';
import { retroDisplayDef } from './retroDisplay';
import { compositeDef } from './composite';
import { sumDef } from './sum';

let registered = false;

export function registerAllOps(): void {
  if (registered) return;
  registered = true;
  registerOp(feedbackDef);
  registerOp(slitScanDef);
  registerOp(glyphRenderDef);
  registerOp(glyphMotionDef);
  registerOp(matrixRainDef);
  registerOp(structureDef);
  registerOp(flowDef);
  registerOp(dataMoshDef);
  registerOp(acidFeedbackDef);
  registerOp(flowMoshDef);
  registerOp(pixelSortDef);
  registerOp(fieldSortDef);
  registerOp(vortexDef);
  registerOp(vortexPacketDef);
  registerOp(curlNoiseDef);
  registerOp(saddleFieldDef);
  registerOp(warpDef);
  registerOp(polarRippleDef);
  registerOp(fluidSimDef);
  registerOp(spiralFieldDef);
  registerOp(domainFoldDef);
  registerOp(gyreFieldDef);
  registerOp(turbulenceWarpDef);
  registerOp(voidEaterDef);
  registerOp(magneticDipoleDef);
  registerOp(channelDef);
  registerOp(grainDef);
  registerOp(modulateDef);
  registerOp(modulateDisplaceDef);
  registerOp(modulateRotateDef);
  registerOp(modulateScaleDef);
  registerOp(modulatePixelateDef);
  registerOp(modulateRepeatDef);
  registerOp(modulateScrollXDef);
  registerOp(modulateScrollYDef);
  registerOp(modulateKaleidDef);
  registerOp(modulateHueDef);
  registerOp(selfModDef);
  registerOp(scaleDef);
  registerOp(rotateDef);
  registerOp(scrollDef);
  registerOp(repeatDef);
  registerOp(pixelateDef);
  registerOp(kaleidDef);
  registerOp(glitchDef);
  registerOp(gradeDef);
  registerOp(colorDef);
  registerOp(posterizeDef);
  registerOp(extractDef);
  registerOp(coloramaDef);
  registerOp(filmGradeDef);
  registerOp(clarityDef);
  registerOp(gradeLUTDef);
  registerOp(debandDitherDef);
  registerOp(retroDisplayDef);
  registerOp(compositeDef);
  registerOp(sumDef);
}

// Chain order matches the typical Hydra source-→-geometry-→-color flow,
// with feedback first (mixes against the prev-frame texture) and modulate
// next so its UV warp acts on every geometry op downstream. Geometry ops
// are ordered conservatively (continuous transforms first, then tiling,
// then pixel quantisation) so each subsequent op sees the post-warped grid.
export const DEFAULT_CHAIN: readonly string[] = [
  'feedback',
  'slitScan',
  'glyphRender',
  'glyphMotion',
  'matrixRain',
  'structure',
  'flow',
  'dataMosh',
  'acidFeedback',
  'flowMosh',
  'pixelSort',
  'fieldSort',
  'vortex',
  'vortexPacket',
  'curlNoise',
  'saddleField',
  'warp',
  'polarRipple',
  'fluidSim',
  'spiralField',
  'domainFold',
  'gyreField',
  'turbulenceWarp',
  'voidEater',
  'magneticDipole',
  'channel',
  'grain',
  'modulate',
  'modulateDisplace',
  'modulateScale',
  'modulatePixelate',
  'modulateRepeat',
  'selfMod',
  'scale',
  'rotate',
  'modulateRotate',
  'modulateScrollX',
  'modulateScrollY',
  'scroll',
  'repeat',
  'pixelate',
  'modulateKaleid',
  'kaleid',
  'glitch',
  'grade',
  'color',
  'posterize',
  'extract',
  'modulateHue',
  'colorama',
  'filmGrade',
  'clarity',
  'gradeLUT',
  'debandDither',
  'retroDisplay',
];
