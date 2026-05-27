import frag from '../video/shaders/modulateKaleid.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PREV_FRAME_UNIFORM,
  PRIMARY_SOURCE_UNIFORM,
} from './shared';

export const modulateKaleidDef = createVideoOperatorDef({
  op: 'modulateKaleid',
  frag,
  uniforms: [PRIMARY_SOURCE_UNIFORM, PREV_FRAME_UNIFORM, paramUniform('u_nSides', 'nSides', 1)],
  paramOrder: ['nSides'],
  defaults: { nSides: 1 },
  params: {
    nSides: passthroughParam({
      id: 'nSides',
      label: 'sides',
      range: [1, 12],
      default: 1,
      curve: 'lin',
      unit: 'sides',
      hint: 'max reflective side count / max self-modulated fold count',
    }),
  },
});
