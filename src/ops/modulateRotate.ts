import frag from '../video/shaders/modulateRotate.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PREV_FRAME_UNIFORM,
  PRIMARY_SOURCE_UNIFORM,
} from './shared';

export const modulateRotateDef = createVideoOperatorDef({
  op: 'modulateRotate',
  frag,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    PREV_FRAME_UNIFORM,
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
      hint: 'prev-frame red-channel rotation depth (video) / signal-driven stereo rotation depth (audio)',
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
