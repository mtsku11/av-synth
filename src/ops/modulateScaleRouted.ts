import frag from '../video/shaders/modulateScaleRouted.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PRIMARY_SOURCE_UNIFORM,
  ROUTED_SOURCE_UNIFORM,
} from './shared';

export const modulateScaleRoutedDef = createVideoOperatorDef({
  op: 'modulateScaleRouted',
  frag,
  inputArity: 2,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    ROUTED_SOURCE_UNIFORM,
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
      hint: 'secondary branch drives zoom depth / routed signal drives pitch-ratio swing depth',
    }),
    offset: passthroughParam({
      id: 'offset',
      label: 'offset',
      range: [0.5, 2],
      default: 1,
      curve: 'log',
      unit: 'ratio',
      hint: 'base zoom factor / base pitch-ratio center under routed modulation',
    }),
  },
});
