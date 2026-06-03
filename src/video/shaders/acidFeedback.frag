#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_owned_state;
uniform vec2 u_resolution;
uniform float u_state_initialized;
uniform float u_time;
uniform float u_mix;
uniform float u_feedback;
uniform float u_leak;
uniform float u_billow;
uniform float u_dispersion;
uniform float u_push;

const float TAU = 6.28318530718;

vec3 sampleSplit(sampler2D tex, vec2 uv, vec2 dR, vec2 dG, vec2 dB) {
  return vec3(
    texture(tex, clamp(uv + dR, 0.0, 1.0)).r,
    texture(tex, clamp(uv + dG, 0.0, 1.0)).g,
    texture(tex, clamp(uv + dB, 0.0, 1.0)).b
  );
}

void main() {
  vec4 liveTexel = texture(u_tex, v_uv);
  vec3 live = liveTexel.rgb;

  if (u_mix < 0.0005 || u_state_initialized < 0.5) {
    o_color = liveTexel;
    return;
  }

  vec2 resolution = max(u_resolution, vec2(1.0));
  vec2 px = 1.0 / resolution;
  float feedback = clamp(u_feedback, 0.0, 0.98);
  float leak = clamp(u_leak, 0.0, 2.0);
  float billow = clamp(u_billow, 0.0, 1.0);
  float dispersion = clamp(u_dispersion, 0.0, 2.0);
  float push = clamp(u_push, 0.0, 1.0);

  vec2 centred = v_uv - 0.5;
  vec2 stateUv = clamp(centred * (1.0 + leak * 0.035) + 0.5, 0.0, 1.0);
  vec3 state = texture(u_owned_state, stateUv).rgb;

  float phase = u_time * (0.85 + billow * 4.5);
  float field = v_uv.x * 3.7 + v_uv.y * 5.1 + dot(state, vec3(0.7, 1.3, 1.9)) * 2.4;
  float billowPhase = phase + field * (0.8 + billow * 5.0);

  float amplitude = (0.75 + push * 3.0) * (0.35 + dot(state, vec3(0.3333333)));
  amplitude *= 1.0 + feedback * 0.75;
  float splitScale = amplitude * mix(1.0, 28.0, dispersion * 0.5);

  vec2 axisR = vec2(cos(billowPhase + state.b * TAU), sin(billowPhase * 0.83 + state.g * TAU));
  vec2 axisG = vec2(
    cos(billowPhase * 1.11 + state.r * TAU),
    sin(billowPhase * 0.91 + state.b * TAU)
  );
  vec2 axisB = vec2(
    cos(billowPhase * 0.93 + state.g * TAU),
    sin(billowPhase * 1.07 + state.r * TAU)
  );

  vec2 dR = axisR * px * splitScale * max(0.15, state.r);
  vec2 dG = axisG * px * splitScale * max(0.15, state.g);
  vec2 dB = axisB * px * splitScale * max(0.15, state.b);

  float splitGain = clamp(dispersion * 0.7 + push * 0.45, 0.0, 1.0);
  vec3 splitState = sampleSplit(u_owned_state, v_uv, dR, dG, dB);
  vec3 splitLive = sampleSplit(u_tex, v_uv, dR * 0.35, dG * 0.35, dB * 0.35);
  vec3 warpedState = mix(state, splitState, splitGain);

  float liveInject = mix(0.52, 0.08, feedback);
  vec3 recursive = mix(warpedState, live, liveInject);

  float multiplyMix = clamp(push * 0.5 + feedback * 0.2, 0.0, 0.8);
  vec3 burned = clamp(splitLive * (0.75 + recursive * 0.95), 0.0, 1.0);
  vec3 wet = mix(recursive, burned, multiplyMix);
  wet = clamp(mix(wet, live, 0.04 + (1.0 - splitGain) * 0.08), 0.0, 1.0);

  o_color = vec4(mix(live, wet, clamp(u_mix, 0.0, 1.0)), liveTexel.a);
}
