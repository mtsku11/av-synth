import frag from '../video/shaders/modulateRepeat.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PREV_FRAME_UNIFORM,
  PRIMARY_SOURCE_UNIFORM,
} from './shared';

export const modulateRepeatDef = createVideoOperatorDef({
  op: 'modulateRepeat',
  frag,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    PREV_FRAME_UNIFORM,
    paramUniform('u_repeatX', 'repeatX', 1),
    paramUniform('u_repeatY', 'repeatY', 1),
    paramUniform('u_offsetX', 'offsetX', 0),
    paramUniform('u_offsetY', 'offsetY', 0),
  ],
  paramOrder: ['repeatX', 'repeatY', 'offsetX', 'offsetY'],
  defaults: { repeatX: 1, repeatY: 1, offsetX: 0, offsetY: 0 },
  params: {
    repeatX: passthroughParam({
      id: 'repeatX',
      label: 'repeatX',
      range: [1, 8],
      default: 1,
      curve: 'lin',
      unit: 'sides',
      hint: 'max horizontal tile count / max self-modulated comb density on the left',
    }),
    repeatY: passthroughParam({
      id: 'repeatY',
      label: 'repeatY',
      range: [1, 8],
      default: 1,
      curve: 'lin',
      unit: 'sides',
      hint: 'max vertical tile count / max self-modulated comb density on the right',
    }),
    offsetX: passthroughParam({
      id: 'offsetX',
      label: 'offsetX',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'tile phase offset / delay phase bias on the left',
    }),
    offsetY: passthroughParam({
      id: 'offsetY',
      label: 'offsetY',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'tile phase offset / delay phase bias on the right',
    }),
  },
});
