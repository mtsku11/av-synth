// scrollX — horizontal UV translation (video) + phase-offset smear (audio).
//
// A horizontal image translation is a spatial phase offset, not a phase
// modulation. The audio analogue therefore stays as a fixed fractional-delay
// branch whose stereo placement can move with speed, instead of scrubbing the
// delay time and reading like unintended vibrato.

import frag from '../video/shaders/scrollX.frag?raw';
import { createVideoOperatorDef, paramUniform, passthroughParam, PRIMARY_SOURCE_UNIFORM, TIME_UNIFORM } from './shared';

export const scrollXDef = createVideoOperatorDef({
  op: 'scrollX',
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
      hint: 'X translation (video) / fixed phase-offset depth (audio)',
    }),
    speed: passthroughParam({
      id: 'speed',
      label: 'speed',
      range: [-5, 5],
      default: 0,
      curve: 'lin',
      unit: 'hz',
      hint: 'X scroll rate (video) / stereo motion rate of the offset layer (audio, signed)',
    }),
  },
  audit: {
    shaderPath: 'src/video/shaders/scrollX.frag',
    neutralDefault: true,
    qaCaseIds: ['audit-scrollX-osc-sweep', 'audit-scrollX-video-cross-source'],
    qaCoverage: 'dedicated',
  },
});
