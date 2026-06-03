import frag from '../video/shaders/modulatePixelate.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PREV_FRAME_UNIFORM,
  PRIMARY_SOURCE_UNIFORM,
  ROUTED_SOURCE_UNIFORM,
} from './shared';

export const modulatePixelateDef = createVideoOperatorDef({
  op: 'modulatePixelate',
  frag,
  inputArity: 2,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    PREV_FRAME_UNIFORM,
    ROUTED_SOURCE_UNIFORM,
    paramUniform('u_source', 'source', 0),
    paramUniform('u_multiple', 'multiple', 0),
    paramUniform('u_offset', 'offset', 500),
  ],
  paramOrder: ['source', 'multiple', 'offset'],
  defaults: { source: 0, multiple: 0, offset: 500 },
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
      range: [0, 500],
      default: 0,
      curve: 'log',
      unit: 'sides',
      hint: 'extra pixel-grid swing driven by the prior frame / extra held-window sweep driven by the live signal',
    }),
    offset: passthroughParam({
      id: 'offset',
      label: 'offset',
      range: [1, 500],
      default: 500,
      curve: 'log',
      unit: 'sides',
      hint: 'base pixel grid resolution / base windowed-resampling resolution',
    }),
  },
});
