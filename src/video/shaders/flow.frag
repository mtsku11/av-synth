#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform sampler2D u_motion_tex;
uniform vec2 u_resolution;
uniform vec2 u_motion_resolution;
uniform float u_mix;
uniform float u_strength;
uniform float u_smear;
uniform float u_memory;
uniform float u_gate;
uniform float u_glitch;
uniform float u_chroma;

vec2 decodeMotion(vec2 encoded) {
  return encoded * 2.0 - 1.0;
}

void main() {
  vec3 dry = texture(u_tex, v_uv).rgb;
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  float glitch = clamp(u_glitch, 0.0, 1.0);
  vec2 blockCount = mix(vec2(1.0), max(vec2(2.0), u_motion_resolution / 24.0), glitch);
  vec2 motionUv = mix(v_uv, (floor(v_uv * blockCount) + 0.5) / blockCount, glitch);
  vec4 motionSample = texture(u_motion_tex, clamp(motionUv, 0.0, 1.0));
  vec2 flow = decodeMotion(motionSample.xy) * motionSample.b;
  float gate = smoothstep(
    max(0.0, u_gate - 0.08),
    min(1.0, u_gate + 0.12),
    max(motionSample.a, motionSample.b)
  );

  vec2 displacement =
    flow *
    (12.0 + glitch * 14.0) *
    clamp(u_strength, 0.0, 1.0) *
    px *
    (1.0 + motionSample.a * 0.75);
  vec2 smearOffset =
    flow *
    (18.0 + motionSample.b * 24.0) *
    clamp(u_smear, 0.0, 1.0) *
    px;

  vec3 current = texture(u_tex, clamp(v_uv + displacement * 0.25, 0.0, 1.0)).rgb;
  vec3 smearNow = texture(u_tex, clamp(v_uv - smearOffset * 0.45, 0.0, 1.0)).rgb;
  vec3 history = texture(
    u_prev_frame,
    clamp(v_uv - smearOffset * (0.7 + clamp(u_memory, 0.0, 1.0) * 1.2), 0.0, 1.0)
  ).rgb;

  vec3 datamosh = mix(smearNow, history, clamp(u_memory, 0.0, 1.0) * gate);
  float chroma = clamp(u_chroma, 0.0, 1.0) * gate;
  vec3 chromaShifted = vec3(
    texture(u_prev_frame, clamp(v_uv - smearOffset * 0.85 - displacement * chroma * 1.2, 0.0, 1.0)).r,
    datamosh.g,
    texture(u_tex, clamp(v_uv + smearOffset * 0.55 + displacement * chroma * 1.2, 0.0, 1.0)).b
  );

  vec3 tear = mix(current, datamosh, gate * (0.55 + clamp(u_smear, 0.0, 1.0) * 0.35));
  vec3 wet = mix(tear, chromaShifted, chroma * 0.65 + glitch * 0.1);
  wet = mix(wet, max(wet, history), gate * glitch * 0.18);

  o_color = vec4(mix(dry, wet, clamp(u_mix, 0.0, 1.0)), 1.0);
}
