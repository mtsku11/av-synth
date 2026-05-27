import frag from '../video/shaders/modulateRouted.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PRIMARY_SOURCE_UNIFORM,
  ROUTED_SOURCE_UNIFORM,
} from './shared';

export const modulateRoutedDef = createVideoOperatorDef({
  op: 'modulateRouted',
  frag,
  inputArity: 2,
  uniforms: [PRIMARY_SOURCE_UNIFORM, ROUTED_SOURCE_UNIFORM, paramUniform('u_amount', 'amount', 0)],
  paramOrder: ['amount'],
  defaults: { amount: 0 },
  params: {
    amount: passthroughParam({
      id: 'amount',
      label: 'amount',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'secondary branch warps the primary image / secondary signal drives phase displacement depth',
    }),
  },
});
