#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_motion_tex;
uniform vec2 u_resolution;
uniform vec3 u_audio_bands;
uniform float u_time;
uniform float u_cell_size;
uniform float u_bass_push;
uniform float u_mid_rotate;
uniform float u_high_jitter;
uniform float u_decay;
uniform float u_ring;
uniform float u_motion_amount;
uniform float u_mix;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 decodeMotion(vec2 encoded) {
  return encoded * 2.0 - 1.0;
}

void main() {
  vec3 dry = texture(u_tex, v_uv).rgb;
  vec2 grid = max(vec2(1.0), u_resolution / max(u_cell_size, 4.0));
  vec2 cell = floor(v_uv * grid);
  vec2 centerUv = (cell + 0.5) / grid;
  vec2 cellPx = u_resolution / grid;
  vec2 localPx = (v_uv - centerUv) * u_resolution;

  vec4 motion = texture(u_motion_tex, centerUv);
  vec2 flow = decodeMotion(motion.xy) * motion.b;
  float cycle = fract(u_time * (0.42 + u_ring * 1.8) + hash12(cell) * 0.34);
  float ringWave = sin(cycle * 6.28318530718) * exp(-cycle * (1.0 + u_decay * 8.0));
  vec2 radial = centerUv - vec2(0.5);
  radial = length(radial) > 1e-5 ? normalize(radial) : vec2(0.0);

  float angle = (u_audio_bands.y * u_mid_rotate + ringWave * u_ring) * 1.45;
  float cs = cos(angle);
  float sn = sin(angle);
  vec2 rotatedPx = mat2(cs, -sn, sn, cs) * localPx;

  float jitterStep = floor(u_time * (5.0 + u_audio_bands.z * 22.0));
  vec2 jitter = vec2(hash12(cell + jitterStep), hash12(cell + jitterStep + 19.7)) - 0.5;
  jitter *= cellPx * u_high_jitter * u_audio_bands.z * 0.72;

  vec2 pushPx = radial * cellPx * u_bass_push * u_audio_bands.x * (0.24 + abs(ringWave));
  vec2 motionPx = flow * cellPx * u_motion_amount * (1.0 + motion.a);
  vec2 sampleUv = centerUv + (rotatedPx + jitter + pushPx + motionPx) / max(u_resolution, vec2(1.0));
  vec3 wet = texture(u_tex, clamp(sampleUv, 0.0, 1.0)).rgb;
  o_color = vec4(mix(dry, wet, clamp(u_mix, 0.0, 1.0)), 1.0);
}
