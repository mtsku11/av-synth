// repeatY — single-axis vertical tiling (video) + right-biased grain freeze
// (audio). The old feedback-comb version tended to read as a resonator rather
// than an abstract repetition texture.

import frag from '../video/shaders/repeatY.frag?raw';
import { createVideoOperatorDef, paramUniform, passthroughParam, PRIMARY_SOURCE_UNIFORM } from './shared';

export const repeatYDef = createVideoOperatorDef({
  op: 'repeatY',
  frag,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    paramUniform('u_reps', 'reps', 1),
    paramUniform('u_offset', 'offset', 0),
  ],
  paramOrder: ['reps', 'offset'],
  // Identity default = reps 1 (no tiling). Hydra invocation default is 3.
  defaults: { reps: 1, offset: 0 },
  params: {
    reps: passthroughParam({
      id: 'reps',
      label: 'reps',
      range: [1, 8],
      default: 1,
      curve: 'lin',
      unit: 'sides',
      hint: 'Y tiles (video) / right-biased grain freeze density (audio)',
    }),
    offset: passthroughParam({
      id: 'offset',
      label: 'offset',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'Y tile phase / freeze window position bias',
    }),
  },
  audit: {
    shaderPath: 'src/video/shaders/repeatY.frag',
    neutralDefault: true,
    qaCaseIds: ['audit-repeatY-osc-sweep', 'audit-repeatY-video-cross-source'],
    qaCoverage: 'dedicated',
  },
});
