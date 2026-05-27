// scrollY — vertical UV translation (video) + stereo pan (audio).
// plan.md §2.7: amount = pan position; speed = pan LFO rate (auto-pan).

import frag from '../video/shaders/scrollY.frag?raw';
import { createVideoOperatorDef, paramUniform, passthroughParam, PRIMARY_SOURCE_UNIFORM, TIME_UNIFORM } from './shared';

export const scrollYDef = createVideoOperatorDef({
  op: 'scrollY',
  frag,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    paramUniform('u_amount', 'amount', 0),
    paramUniform('u_speed', 'speed', 0),
    TIME_UNIFORM,
  ],
  paramOrder: ['amount', 'speed'],
  // Identity default = no scroll. Hydra invocation default amount is 0.5.
  defaults: { amount: 0, speed: 0 },
  params: {
    amount: passthroughParam({
      id: 'amount',
      label: 'amount',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'Y translation (video) / stereo pan position (audio)',
    }),
    speed: passthroughParam({
      id: 'speed',
      label: 'speed',
      range: [-5, 5],
      default: 0,
      curve: 'lin',
      unit: 'hz',
      hint: 'Y scroll rate (video) / auto-pan rate (audio, signed)',
    }),
  },
  audit: {
    shaderPath: 'src/video/shaders/scrollY.frag',
    neutralDefault: true,
    qaCaseIds: ['audit-scrollY-osc-sweep', 'audit-scrollY-video-cross-source'],
    qaCoverage: 'dedicated',
  },
});
