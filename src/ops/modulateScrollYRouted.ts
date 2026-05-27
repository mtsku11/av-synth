import frag from '../video/shaders/modulateScrollYRouted.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PRIMARY_SOURCE_UNIFORM,
  ROUTED_SOURCE_UNIFORM,
  TIME_UNIFORM,
} from './shared';

export const modulateScrollYRoutedDef = createVideoOperatorDef({
  op: 'modulateScrollYRouted',
  frag,
  inputArity: 2,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    ROUTED_SOURCE_UNIFORM,
    paramUniform('u_amount', 'amount', 0),
    paramUniform('u_speed', 'speed', 0),
    TIME_UNIFORM,
  ],
  paramOrder: ['amount', 'speed'],
  defaults: { amount: 0, speed: 0 },
  params: {
    amount: passthroughParam({
      id: 'amount',
      label: 'amount',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'secondary branch drives vertical drift depth / secondary signal drives stereo-pan depth',
    }),
    speed: passthroughParam({
      id: 'speed',
      label: 'speed',
      range: [-5, 5],
      default: 0,
      curve: 'lin',
      unit: 'hz',
      hint: 'base scroll rate / added auto-pan rate under routed modulation',
    }),
  },
});
