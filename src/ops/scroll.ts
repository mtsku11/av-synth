// scroll — simultaneous X+Y UV translation (video) + phase/pan coupling (audio).
// Merges scrollX and scrollY into one op. x/y are static offsets; speedX/speedY
// are time-driven rates.

import frag from '../video/shaders/scroll.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PRIMARY_SOURCE_UNIFORM,
  TIME_UNIFORM,
} from './shared';

export const scrollDef = createVideoOperatorDef({
  op: 'scroll',
  frag,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    paramUniform('u_x', 'x', 0),
    paramUniform('u_y', 'y', 0),
    paramUniform('u_speedX', 'speedX', 0),
    paramUniform('u_speedY', 'speedY', 0),
    TIME_UNIFORM,
  ],
  paramOrder: ['x', 'y', 'speedX', 'speedY'],
  defaults: { x: 0, y: 0, speedX: 0, speedY: 0 },
  params: {
    x: passthroughParam({
      id: 'x',
      label: 'x',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'X translation (video) / fixed phase-offset depth (audio)',
    }),
    y: passthroughParam({
      id: 'y',
      label: 'y',
      range: [0, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'Y translation (video) / stereo pan position (audio)',
    }),
    speedX: passthroughParam({
      id: 'speedX',
      label: 'speedX',
      range: [-5, 5],
      default: 0,
      curve: 'lin',
      unit: 'hz',
      hint: 'X scroll rate (video) / stereo motion rate of the offset layer (audio, signed)',
    }),
    speedY: passthroughParam({
      id: 'speedY',
      label: 'speedY',
      range: [-5, 5],
      default: 0,
      curve: 'lin',
      unit: 'hz',
      hint: 'Y scroll rate (video) / auto-pan rate (audio, signed)',
    }),
  },
  audit: {
    shaderPath: 'src/video/shaders/scroll.frag',
    neutralDefault: true,
    qaCaseIds: ['audit-scroll-osc-sweep', 'audit-scroll-video-cross-source'],
    qaCoverage: 'dedicated',
  },
});
