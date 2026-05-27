import frag from '../video/shaders/modulatePixelateRouted.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PRIMARY_SOURCE_UNIFORM,
  ROUTED_SOURCE_UNIFORM,
} from './shared';

export const modulatePixelateRoutedDef = createVideoOperatorDef({
  op: 'modulatePixelateRouted',
  frag,
  inputArity: 2,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    ROUTED_SOURCE_UNIFORM,
    paramUniform('u_multiple', 'multiple', 0),
    paramUniform('u_offset', 'offset', 500),
  ],
  paramOrder: ['multiple', 'offset'],
  defaults: { multiple: 0, offset: 500 },
  params: {
    multiple: passthroughParam({
      id: 'multiple',
      label: 'multiple',
      range: [0, 500],
      default: 0,
      curve: 'log',
      unit: 'sides',
      hint: 'secondary branch drives extra pixel-grid swing / routed signal drives held-window sweep depth',
    }),
    offset: passthroughParam({
      id: 'offset',
      label: 'offset',
      range: [1, 500],
      default: 500,
      curve: 'log',
      unit: 'sides',
      hint: 'base pixel grid resolution / base windowed-resampling resolution under routed control',
    }),
  },
});
