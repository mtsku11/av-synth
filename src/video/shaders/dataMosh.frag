#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_owned_state;
uniform sampler2D u_motion_tex;
uniform vec2 u_resolution;
uniform vec2 u_motion_resolution;
uniform float u_state_initialized;
uniform float u_mix;
uniform float u_drift;
uniform float u_decay;
uniform float u_chunk;

void main() {
  vec3 live = texture(u_tex, v_uv).rgb;

  if (u_state_initialized < 0.5) {
    o_color = vec4(live, 1.0);
    return;
  }

  vec2 px = 1.0 / max(u_resolution, vec2(1.0));

  // Chunk UV to macroblock granularity — gives the codec-block smear feel.
  float chunk = clamp(u_chunk, 0.0, 1.0);
  vec2 blockCount = mix(vec2(1.0), max(vec2(2.0), u_motion_resolution / 24.0), chunk);
  vec2 motionUv = mix(v_uv, (floor(v_uv * blockCount) + 0.5) / blockCount, chunk);
  vec4 motionSample = texture(u_motion_tex, clamp(motionUv, 0.0, 1.0));

  // flow: direction (unit vec) scaled by motion magnitude.
  vec2 flow = (motionSample.rg * 2.0 - 1.0) * motionSample.b;

  // Displace the accumulator along the motion field every frame.
  // drift controls displacement strength (0 = frozen accumulator, 1 = full drift).
  float drift = clamp(u_drift, 0.0, 2.0);
  vec2 displacement = flow * px * 64.0 * drift;
  vec3 moshed = texture(u_owned_state, clamp(v_uv - displacement, 0.0, 1.0)).rgb;

  // Decay: each frame blend a small amount of live video into the accumulator.
  // At 0 the mosh holds forever. At ~0.1 it fades toward live in ~10 frames.
  float decay = clamp(u_decay, 0.0, 0.5);
  vec3 accumulated = mix(moshed, live, decay);

  o_color = vec4(mix(live, accumulated, clamp(u_mix, 0.0, 1.0)), 1.0);
}
