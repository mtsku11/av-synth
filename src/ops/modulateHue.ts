import frag from '../video/shaders/modulateHue.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PREV_FRAME_UNIFORM,
  PRIMARY_SOURCE_UNIFORM,
  ROUTED_SOURCE_UNIFORM,
} from './shared';

export const modulateHueDef = createVideoOperatorDef({
  op: 'modulateHue',
  frag,
  inputArity: 2,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    PREV_FRAME_UNIFORM,
    ROUTED_SOURCE_UNIFORM,
    paramUniform('u_source', 'source', 0),
    paramUniform('u_amount', 'amount', 0),
  ],
  paramOrder: ['source', 'amount'],
  defaults: { source: 0, amount: 0 },
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
      range: [-1, 1],
      default: 0,
      curve: 'lin',
      unit: 'oct',
      hint: 'hue rotation depth driven by selected source / pitch-color shift depth',
    }),
  },
});
