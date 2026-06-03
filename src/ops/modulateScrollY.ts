import frag from '../video/shaders/modulateScrollY.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PREV_FRAME_UNIFORM,
  PRIMARY_SOURCE_UNIFORM,
  ROUTED_SOURCE_UNIFORM,
  TIME_UNIFORM,
} from './shared';

export const modulateScrollYDef = createVideoOperatorDef({
  op: 'modulateScrollY',
  frag,
  inputArity: 2,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    PREV_FRAME_UNIFORM,
    ROUTED_SOURCE_UNIFORM,
    paramUniform('u_source', 'source', 0),
    paramUniform('u_amount', 'amount', 0),
    paramUniform('u_speed', 'speed', 0),
    TIME_UNIFORM,
  ],
  paramOrder: ['source', 'amount', 'speed'],
  defaults: { source: 0, amount: 0, speed: 0 },
  params: {
    source: passthroughParam({
      id: 'source',
      label: 'source',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: '0=prev frame self-modulates, 1=routed second input',
    }),
    amount: passthroughParam({
      id: 'amount',
      label: 'amount',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'vertical drift depth driven by selected source / stereo-pan depth',
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
