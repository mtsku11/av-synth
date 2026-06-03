import frag from '../video/shaders/extract.frag?raw';
import type { ParamSpec } from '../core/params';
import {
  PRIMARY_SOURCE_UNIFORM,
  createVideoOperatorDef,
  paramUniform,
  passthroughParam,
} from './shared';

function param(
  id: string,
  label: string,
  range: readonly [number, number],
  defaultValue: number,
  curve: ParamSpec['curve'],
  hint: string,
): ReturnType<typeof passthroughParam> {
  return passthroughParam({ id, label, range, default: defaultValue, curve, unit: 'norm', hint });
}

export const extractDef = createVideoOperatorDef({
  op: 'extract',
  frag,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    paramUniform('u_mode', 'mode', 0),
    paramUniform('u_amount', 'amount', 0),
    paramUniform('u_threshold', 'threshold', 0.5),
    paramUniform('u_tolerance', 'tolerance', 0.1),
    paramUniform('u_flip', 'flip', 0),
  ],
  paramOrder: ['mode', 'amount', 'threshold', 'tolerance', 'flip'],
  defaults: {
    mode: 0,
    amount: 0,
    threshold: 0.5,
    tolerance: 0.1,
    flip: 0,
  },
  params: {
    mode: param('mode', 'mode', [0, 2], 0, 'lin', '0=luma key, 1=hard threshold, 2=colour invert'),
    amount: param('amount', 'amount', [0, 1], 0, 'lin', 'wet/dry; 0 is bypass for all modes'),
    threshold: param('threshold', 'threshold', [0, 1], 0.5, 'lin', 'luminance cut point (luma/thresh modes)'),
    tolerance: param('tolerance', 'tolerance', [0.001, 1], 0.1, 'lin', 'soft-knee width (luma/thresh modes)'),
    flip: param('flip', 'flip', [0, 1], 0, 'lin', 'luma mode: flip bright-pass to dark-pass'),
  },
  audit: {
    shaderPath: 'src/video/shaders/extract.frag',
    neutralDefault: true,
    qaCaseIds: ['audit-extract-mode-sweep'],
    qaCoverage: 'dedicated',
  },
});
