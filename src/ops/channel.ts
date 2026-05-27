import frag from '../video/shaders/channel.frag?raw';
import { createVideoOperatorDef, PRIMARY_SOURCE_UNIFORM, vec4Uniform } from './shared';

type ChannelMode = 'r' | 'g' | 'b' | 'a';

const CHANNEL_WEIGHTS: Record<ChannelMode, readonly [number, number, number, number]> = {
  r: [1, 0, 0, 0],
  g: [0, 1, 0, 0],
  b: [0, 0, 1, 0],
  a: [0, 0, 0, 1],
};

function makeChannelDef(op: ChannelMode) {
  return createVideoOperatorDef({
    op,
    frag,
    uniforms: [PRIMARY_SOURCE_UNIFORM, vec4Uniform('u_weights', CHANNEL_WEIGHTS[op])],
    paramOrder: [],
    defaults: {},
    params: {},
    audit: {
      shaderPath: 'src/video/shaders/channel.frag',
      neutralDefault: false,
      qaCaseIds: ['audit-channel-isolate'],
      qaCoverage: 'shared',
    },
  });
}

export const rDef = makeChannelDef('r');
export const gDef = makeChannelDef('g');
export const bDef = makeChannelDef('b');
export const aDef = makeChannelDef('a');
