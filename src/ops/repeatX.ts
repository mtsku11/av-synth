// repeatX — single-axis horizontal tiling (video) + left-biased grain stutter
// (audio). The old feedforward comb was mathematically tidy but too thin in
// stacked product chains.

import frag from '../video/shaders/repeatX.frag?raw';
import { createVideoOperatorDef, paramUniform, passthroughParam, PRIMARY_SOURCE_UNIFORM } from './shared';

export const repeatXDef = createVideoOperatorDef({
  op: 'repeatX',
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
      hint: 'X tiles (video) / left-biased grain stutter density (audio)',
    }),
    offset: passthroughParam({
      id: 'offset',
      label: 'offset',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'X tile phase / grain window position bias',
    }),
  },
  audit: {
    shaderPath: 'src/video/shaders/repeatX.frag',
    neutralDefault: true,
    qaCaseIds: ['audit-repeatX-osc-sweep', 'audit-repeatX-video-cross-source'],
    qaCoverage: 'dedicated',
  },
});
