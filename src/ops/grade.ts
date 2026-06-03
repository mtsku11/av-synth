import frag from '../video/shaders/grade.frag?raw';
import {
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
  PRIMARY_SOURCE_UNIFORM,
} from './shared';

export const gradeDef = createVideoOperatorDef({
  op: 'grade',
  frag,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    paramUniform('u_brightness', 'brightness', 0),
    paramUniform('u_contrast', 'contrast', 1),
    paramUniform('u_saturate', 'saturate', 1),
    paramUniform('u_hue', 'hue', 0),
  ],
  paramOrder: ['brightness', 'contrast', 'saturate', 'hue'],
  defaults: { brightness: 0, contrast: 1, saturate: 1, hue: 0 },
  params: {
    brightness: passthroughParam({
      id: 'brightness',
      label: 'brightness',
      range: [-1, 1],
      default: 0,
      curve: 'lin',
      unit: 'norm',
      hint: 'RGB offset; 0 = identity',
    }),
    contrast: passthroughParam({
      id: 'contrast',
      label: 'contrast',
      range: [0, 3],
      default: 1,
      curve: 'lin',
      unit: 'ratio',
      hint: 'contrast around mid-grey; 1 = identity',
    }),
    saturate: passthroughParam({
      id: 'saturate',
      label: 'saturate',
      range: [0, 3],
      default: 1,
      curve: 'lin',
      unit: 'ratio',
      hint: 'HSV saturation multiplier; 1 = identity',
    }),
    hue: passthroughParam({
      id: 'hue',
      label: 'hue',
      range: [-1, 1],
      default: 0,
      curve: 'lin',
      unit: 'oct',
      hint: 'hue rotation (video) / pitch shift in octaves (audio); 0 = identity',
    }),
  },
  audit: {
    shaderPath: 'src/video/shaders/grade.frag',
    neutralDefault: true,
    qaCaseIds: ['audit-grade-osc-sweep'],
    qaCoverage: 'dedicated',
  },
});
