import frag from '../video/shaders/modulateRotateRouted.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PRIMARY_SOURCE_UNIFORM,
  ROUTED_SOURCE_UNIFORM,
} from './shared';

export const modulateRotateRoutedDef = createVideoOperatorDef({
  op: 'modulateRotateRouted',
  frag,
  inputArity: 2,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    ROUTED_SOURCE_UNIFORM,
    paramUniform('u_multiple', 'multiple', 0),
    paramUniform('u_offset', 'offset', 0),
  ],
  paramOrder: ['multiple', 'offset'],
  defaults: { multiple: 0, offset: 0 },
  params: {
    multiple: passthroughParam({
      id: 'multiple',
      label: 'multiple',
      range: [-1, 1],
      default: 0,
      curve: 'lin',
      unit: 'rad',
      hint: 'secondary branch drives rotation depth / routed signal twists the primary stereo field',
    }),
    offset: passthroughParam({
      id: 'offset',
      label: 'offset',
      range: [-Math.PI, Math.PI],
      default: 0,
      curve: 'lin',
      unit: 'rad',
      hint: 'static rotation bias added after the routed turn amount',
    }),
  },
});
