import frag from '../video/shaders/modulateScale.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PREV_FRAME_UNIFORM,
  PRIMARY_SOURCE_UNIFORM,
} from './shared';

export const modulateScaleDef = createVideoOperatorDef({
  op: 'modulateScale',
  frag,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    PREV_FRAME_UNIFORM,
    paramUniform('u_multiple', 'multiple', 0),
    paramUniform('u_offset', 'offset', 1),
  ],
  paramOrder: ['multiple', 'offset'],
  defaults: { multiple: 0, offset: 1 },
  params: {
    multiple: passthroughParam({
      id: 'multiple',
      label: 'multiple',
      range: [-1, 1],
      default: 0,
      curve: 'lin',
      unit: 'ratio',
      hint: 'signal-driven zoom depth (video) / self-modulated pitch-ratio swing (audio)',
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
