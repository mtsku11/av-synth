import frag from '../video/shaders/modulateRepeatRouted.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PRIMARY_SOURCE_UNIFORM,
  ROUTED_SOURCE_UNIFORM,
} from './shared';

export const modulateRepeatRoutedDef = createVideoOperatorDef({
  op: 'modulateRepeatRouted',
  frag,
  inputArity: 2,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    ROUTED_SOURCE_UNIFORM,
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
      hint: 'secondary branch sets horizontal tile density / routed signal drives left-channel stutter density',
    }),
    repeatY: passthroughParam({
      id: 'repeatY',
      label: 'repeatY',
      range: [1, 8],
      default: 1,
      curve: 'lin',
      unit: 'sides',
      hint: 'secondary branch sets vertical tile density / routed signal drives right-channel stutter density',
    }),
    offsetX: passthroughParam({
      id: 'offsetX',
      label: 'offsetX',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'horizontal tile phase bias / left-channel replay phase bias',
    }),
    offsetY: passthroughParam({
      id: 'offsetY',
      label: 'offsetY',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'vertical tile phase bias / right-channel replay phase bias',
    }),
  },
});
