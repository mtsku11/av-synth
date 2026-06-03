// repeat — UV tiling (video) + stereo grain-slice repetition (audio).
// The audio side is intentionally no longer a literal comb filter: repeated
// image tiles read more convincingly as looping recent-time grains than as a
// resonator when stacked in the product path.
//
// axis 0 = both axes (default), 1 = X-only (absorbs repeatX), 2 = Y-only (absorbs repeatY).

import frag from '../video/shaders/repeat.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PRIMARY_SOURCE_UNIFORM,
} from './shared';

export const repeatDef = createVideoOperatorDef({
  op: 'repeat',
  frag,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    paramUniform('u_axis', 'axis', 0),
    paramUniform('u_repeatX', 'repeatX', 1),
    paramUniform('u_repeatY', 'repeatY', 1),
    paramUniform('u_offsetX', 'offsetX', 0),
    paramUniform('u_offsetY', 'offsetY', 0),
  ],
  paramOrder: ['axis', 'repeatX', 'repeatY', 'offsetX', 'offsetY'],
  // Identity default = axis 0, 1×1 tiling with no offset. Hydra invocation default is 3×3.
  defaults: { axis: 0, repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0 },
  params: {
    axis: passthroughParam({
      id: 'axis',
      label: 'axis',
      range: [0, 2],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: '0=both 1=X-only 2=Y-only',
    }),
    repeatX: passthroughParam({
      id: 'repeatX',
      label: 'repeatX',
      range: [1, 8],
      default: 1,
      curve: 'lin',
      unit: 'sides',
      hint: 'X tiles (video) / recent-time grain repeat density (audio)',
    }),
    repeatY: passthroughParam({
      id: 'repeatY',
      label: 'repeatY',
      range: [1, 8],
      default: 1,
      curve: 'lin',
      unit: 'sides',
      hint: 'Y tiles (video) / stereo grain repeat density (audio)',
    }),
    offsetX: passthroughParam({
      id: 'offsetX',
      label: 'offsetX',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'X tile phase shift / grain loop position bias',
    }),
    offsetY: passthroughParam({
      id: 'offsetY',
      label: 'offsetY',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'Y tile phase shift / stereo grain phase bias',
    }),
  },
  audit: {
    shaderPath: 'src/video/shaders/repeat.frag',
    neutralDefault: true,
    qaCaseIds: ['audit-repeat-osc-sweep', 'audit-repeat-video-cross-source', 'audit-repeat-axis-sweep'],
    qaCoverage: 'dedicated',
  },
});
