import frag from '../video/shaders/modulateScrollY.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PREV_FRAME_UNIFORM,
  PRIMARY_SOURCE_UNIFORM,
  TIME_UNIFORM,
} from './shared';

export const modulateScrollYDef = createVideoOperatorDef({
  op: 'modulateScrollY',
  frag,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    PREV_FRAME_UNIFORM,
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
      hint: 'self-modulated vertical drift depth / self-modulated stereo-pan depth',
    }),
    speed: passthroughParam({
      id: 'speed',
      label: 'speed',
      range: [-5, 5],
      default: 0,
      curve: 'lin',
      unit: 'hz',
      hint: 'base scroll rate / added auto-pan rate under self modulation',
    }),
  },
});
