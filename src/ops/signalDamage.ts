import frag from '../video/shaders/signalDamage.frag?raw';
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
) {
  const spec: ParamSpec = {
    id,
    label,
    range,
    default: defaultValue,
    curve,
    unit: 'norm',
    hint,
  };
  return passthroughParam(spec);
}

export const signalDamageDef = createVideoOperatorDef({
  op: 'signalDamage',
  frag,
  uniforms: [
    PRIMARY_SOURCE_UNIFORM,
    TIME_UNIFORM,
    paramUniform('u_mix', 'mix', 0),
    paramUniform('u_displace', 'displace', 0.28),
    paramUniform('u_block', 'block', 96),
    paramUniform('u_damage', 'damage', 0.45),
    paramUniform('u_quantize', 'quantize', 0.45),
    paramUniform('u_tint', 'tint', 0.55),
    paramUniform('u_overlay', 'overlay', 0.35),
    paramUniform('u_jitter', 'jitter', 0.3),
  ],
  paramOrder: ['mix', 'displace', 'block', 'damage', 'quantize', 'tint', 'overlay', 'jitter'],
  defaults: {
    mix: 0,
    displace: 0.28,
    block: 96,
    damage: 0.45,
    quantize: 0.45,
    tint: 0.55,
    overlay: 0.35,
    jitter: 0.3,
  },
  params: {
    mix: param('mix', 'mix', [0, 1], 0, 'lin', 'dry-to-damage blend; 0 is bypass'),
    displace: param(
      'displace',
      'displace',
      [0, 1],
      0.28,
      'lin',
      'interference offset strength before the stepped damage layer takes over',
    ),
    block: param(
      'block',
      'block',
      [8, 192],
      96,
      'log',
      'coarse region size in pixels; larger values hold the corruption stable over bigger chunks',
    ),
    damage: param(
      'damage',
      'damage',
      [0, 1],
      0.45,
      'lin',
      'ordered-dither corruption density and chroma breakup inside damaged regions',
    ),
    quantize: param(
      'quantize',
      'quantize',
      [0, 1],
      0.45,
      'lin',
      'colour-step reduction applied only where the damage mask engages',
    ),
    tint: param(
      'tint',
      'tint',
      [0, 1],
      0.55,
      'lin',
      'cool transmission wash that pushes the damage away from generic posterisation',
    ),
    overlay: param(
      'overlay',
      'overlay',
      [0, 1],
      0.35,
      'lin',
      'how strongly the tinted overlay response bites into damaged regions',
    ),
    jitter: param(
      'jitter',
      'jitter',
      [0, 1],
      0.3,
      'lin',
      'time-varying block instability and horizontal line wobble',
    ),
  },
  audit: {
    shaderPath: 'src/video/shaders/signalDamage.frag',
    neutralDefault: true,
    qaCaseIds: ['audit-signal-damage-video-sweep'],
    qaCoverage: 'dedicated',
  },
});
