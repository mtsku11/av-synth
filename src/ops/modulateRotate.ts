import frag from '../video/shaders/modulateRotate.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PREV_FRAME_UNIFORM,
  PRIMARY_SOURCE_UNIFORM,
  ROUTED_SOURCE_UNIFORM,
} from './shared';

export const modulateRotateDef = createVideoOperatorDef({
  op: 'modulateRotate',
  frag,
  inputArity: 2,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    PREV_FRAME_UNIFORM,
    ROUTED_SOURCE_UNIFORM,
    paramUniform('u_source', 'source', 0),
    paramUniform('u_multiple', 'multiple', 0),
    paramUniform('u_offset', 'offset', 0),
  ],
  paramOrder: ['source', 'multiple', 'offset'],
  defaults: { source: 0, multiple: 0, offset: 0 },
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
    multiple: passthroughParam({
      id: 'multiple',
      label: 'multiple',
      range: [-1, 1],
      default: 0,
      curve: 'lin',
      unit: 'rad',
      hint: 'rotation depth driven by selected source / stereo rotation depth',
    }),
    offset: passthroughParam({
      id: 'offset',
      label: 'offset',
      range: [-Math.PI, Math.PI],
      default: 0,
      curve: 'lin',
      unit: 'rad',
      hint: 'static rotation bias added after the self-modulated angle in both domains',
    }),
  },
});
