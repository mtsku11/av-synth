import frag from '../video/shaders/modulateScale.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PREV_FRAME_UNIFORM,
  PRIMARY_SOURCE_UNIFORM,
  ROUTED_SOURCE_UNIFORM,
} from './shared';

export const modulateScaleDef = createVideoOperatorDef({
  op: 'modulateScale',
  frag,
  inputArity: 2,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    PREV_FRAME_UNIFORM,
    ROUTED_SOURCE_UNIFORM,
    paramUniform('u_source', 'source', 0),
    paramUniform('u_multiple', 'multiple', 0),
    paramUniform('u_offset', 'offset', 1),
  ],
  paramOrder: ['source', 'multiple', 'offset'],
  defaults: { source: 0, multiple: 0, offset: 1 },
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
      unit: 'ratio',
      hint: 'zoom depth driven by selected source / pitch-ratio swing depth',
    }),
    offset: passthroughParam({
      id: 'offset',
      label: 'offset',
      range: [0.5, 2],
      default: 1,
      curve: 'log',
      unit: 'ratio',
      hint: 'base zoom factor / base pitch ratio under self modulation',
    }),
  },
});
