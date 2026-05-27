import frag from '../video/shaders/modulateHueRouted.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PRIMARY_SOURCE_UNIFORM,
  ROUTED_SOURCE_UNIFORM,
} from './shared';

export const modulateHueRoutedDef = createVideoOperatorDef({
  op: 'modulateHueRouted',
  frag,
  inputArity: 2,
  uniforms: [PRIMARY_SOURCE_UNIFORM, ROUTED_SOURCE_UNIFORM, paramUniform('u_amount', 'amount', 0)],
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
      hint: 'secondary branch rotates the primary hue field / secondary signal drives pitch-color shift',
    }),
  },
});
