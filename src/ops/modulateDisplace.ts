import frag from '../video/shaders/modulateDisplace.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PRIMARY_SOURCE_UNIFORM,
  ROUTED_SOURCE_UNIFORM,
} from './shared';

export const modulateDisplaceDef = createVideoOperatorDef({
  op: 'modulateDisplace',
  frag,
  inputArity: 2,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    ROUTED_SOURCE_UNIFORM,
    paramUniform('u_amount', 'amount', 0),
    paramUniform('u_bias', 'bias', 0),
  ],
  paramOrder: ['amount', 'bias'],
  defaults: { amount: 0, bias: 0 },
  params: {
    amount: passthroughParam({
      id: 'amount',
      label: 'amount',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'secondary branch displaces the primary image / secondary signal drives recent-time displacement depth',
    }),
    bias: passthroughParam({
      id: 'bias',
      label: 'bias',
      range: [-1, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'push the modulator toward dark/bright or negative/positive control regions',
    }),
  },
});
