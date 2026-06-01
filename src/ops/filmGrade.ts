import frag from '../video/shaders/filmGrade.frag?raw';
import type { ParamSpec } from '../core/params';
import {
  PRIMARY_SOURCE_UNIFORM,
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
} from './shared';

function param(
  id: string,
  label: string,
  range: readonly [number, number],
  defaultValue: number,
  hint: string,
) {
  const spec: ParamSpec = {
    id,
    label,
    range,
    default: defaultValue,
    curve: 'lin',
    unit: 'norm',
    hint,
  };
  return passthroughParam(spec);
}

export const filmGradeDef = createVideoOperatorDef({
  op: 'filmGrade',
  frag,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    paramUniform('u_exposure', 'exposure', 0),
    paramUniform('u_gamma', 'gamma', 1),
    paramUniform('u_contrast', 'contrast', 1),
    paramUniform('u_saturation', 'saturation', 1),
    paramUniform('u_temperature', 'temperature', 0),
    paramUniform('u_tint', 'tint', 0),
    paramUniform('u_toe', 'toe', 0),
    paramUniform('u_shoulder', 'shoulder', 0),
    paramUniform('u_vignette', 'vignette', 0),
    paramUniform('u_mix', 'mix', 0),
  ],
  paramOrder: [
    'mix',
    'exposure',
    'gamma',
    'contrast',
    'saturation',
    'temperature',
    'tint',
    'toe',
    'shoulder',
    'vignette',
  ],
  defaults: {
    mix: 0,
    exposure: 0,
    gamma: 1,
    contrast: 1,
    saturation: 1,
    temperature: 0,
    tint: 0,
    toe: 0,
    shoulder: 0,
    vignette: 0,
  },
  params: {
    mix: param('mix', 'mix', [0, 1], 0, 'dry-to-grade blend; 0 is bypass'),
    exposure: param(
      'exposure',
      'exposure',
      [-1.5, 1.5],
      0,
      'scene exposure trim in stop-like steps before the filmic curve',
    ),
    gamma: param(
      'gamma',
      'gamma',
      [0.4, 1.8],
      1,
      'midtone pivot; above 1 brightens, below 1 deepens',
    ),
    contrast: param(
      'contrast',
      'contrast',
      [0.5, 1.8],
      1,
      'post-curve contrast around display mid-grey',
    ),
    saturation: param(
      'saturation',
      'saturation',
      [0, 2],
      1,
      'colour intensity after exposure and gamma',
    ),
    temperature: param('temperature', 'temperature', [-1, 1], 0, 'negative cools, positive warms'),
    tint: param('tint', 'tint', [-1, 1], 0, 'green-magenta balance trim'),
    toe: param('toe', 'toe', [0, 1], 0, 'shadow lift and black-roll softness'),
    shoulder: param('shoulder', 'shoulder', [0, 1], 0, 'highlight compression and white roll-off'),
    vignette: param('vignette', 'vignette', [0, 1], 0, 'edge darkening for finishing focus'),
  },
});
