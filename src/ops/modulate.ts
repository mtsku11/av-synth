// modulate — function composition in the domain (UV warp / phase warp).
//
// plan.md §5.1: output(p) = base(p + amount · mod(p))
//   p = UV (video) or t (audio)
// The modulator runs at the global LFO rate (CouplingContext.rate), so the
// visual UV jitter and the audio delay-time jitter share their characteristic
// frequency exactly.
//
// Audio side is a sample-accurate delay-read phase modulator in an
// AudioWorklet. It still uses the global LFO rate because the graph does not
// yet route a second signal as the modulator source, but the modulation itself
// is no longer k-rate DelayNode automation.

import frag from '../video/shaders/modulate.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PRIMARY_SOURCE_UNIFORM,
  RATE_UNIFORM,
  TIME_UNIFORM,
} from './shared';

export const modulateDef = createVideoOperatorDef({
  op: 'modulate',
  frag,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    paramUniform('u_amount', 'amount', 0),
    TIME_UNIFORM,
    RATE_UNIFORM,
  ],
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  params: {
    amount: passthroughParam({
      id: 'amount',
      label: 'modulate',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'UV displacement (video) / delay-time PM depth (audio); LFO from ctx.rate',
    }),
  },
});
