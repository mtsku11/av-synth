import frag from '../video/shaders/modulateHue.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PREV_FRAME_UNIFORM,
  PRIMARY_SOURCE_UNIFORM,
} from './shared';

export const modulateHueDef = createVideoOperatorDef({
  op: 'modulateHue',
  frag,
  uniforms: [PRIMARY_SOURCE_UNIFORM, PREV_FRAME_UNIFORM, paramUniform('u_amount', 'amount', 0)],
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  params: {
    amount: passthroughParam({
      id: 'amount',
      label: 'amount',
      range: [-1, 1],
      default: 0,
      curve: 'lin',
      unit: 'oct',
      hint: 'self-modulated hue rotation depth / self-modulated pitch-color shift in octaves',
    }),
  },
});
