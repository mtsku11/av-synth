import frag from '../video/shaders/glitch.frag?raw';
import type { ParamSpec } from '../core/params';
import {
  PRIMARY_SOURCE_UNIFORM,
  TIME_UNIFORM,
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

export const glitchDef = createVideoOperatorDef({
  op: 'glitch',
  frag,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    TIME_UNIFORM,
    paramUniform('u_type', 'type', 0),
    paramUniform('u_amount', 'amount', 0),
    paramUniform('u_displace', 'displace', 0.28),
    paramUniform('u_block', 'block', 96),
    paramUniform('u_damage', 'damage', 0.45),
    paramUniform('u_quantize', 'quantize', 0.45),
    paramUniform('u_tint', 'tint', 0.55),
    paramUniform('u_overlay', 'overlay', 0.35),
    paramUniform('u_jitter', 'jitter', 0.3),
    paramUniform('u_scale', 'scale', 100),
  ],
  paramOrder: ['type', 'amount', 'displace', 'block', 'damage', 'quantize', 'tint', 'overlay', 'jitter', 'scale'],
  defaults: {
    type: 0,
    amount: 0,
    displace: 0.28,
    block: 96,
    damage: 0.45,
    quantize: 0.45,
    tint: 0.55,
    overlay: 0.35,
    jitter: 0.3,
    scale: 100,
  },
  params: {
    type: param('type', 'type', [0, 2], 0, 'lin', '0=signal damage, 1=chroma shift, 2=chroma fract'),
    amount: param('amount', 'amount', [0, 1], 0, 'lin', 'wet/dry; 0 is bypass for all modes'),
    displace: param('displace', 'displace', [0, 1], 0.28, 'lin', 'signal: interference offset strength'),
    block: param('block', 'block', [8, 192], 96, 'log', 'signal: coarse region size in pixels'),
    damage: param('damage', 'damage', [0, 1], 0.45, 'lin', 'signal: ordered-dither corruption density'),
    quantize: param('quantize', 'quantize', [0, 1], 0.45, 'lin', 'signal: colour-step reduction in damaged regions'),
    tint: param('tint', 'tint', [0, 1], 0.55, 'lin', 'signal: cool transmission wash'),
    overlay: param('overlay', 'overlay', [0, 1], 0.35, 'lin', 'signal: overlay response in damaged regions'),
    jitter: param('jitter', 'jitter', [0, 1], 0.3, 'lin', 'signal: time-varying block instability'),
    scale: param('scale', 'scale', [1, 500], 100, 'lin', 'fract: chroma amplification — low=subtle, high=dense bands'),
  },
  audit: {
    shaderPath: 'src/video/shaders/glitch.frag',
    neutralDefault: true,
    qaCaseIds: ['audit-glitch-type-sweep'],
    qaCoverage: 'dedicated',
  },
});
