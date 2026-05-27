#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform float u_amount;
uniform float u_ratio;
uniform float u_index;
uniform float u_feedback;
uniform float u_smoothing;
uniform float u_tone;
uniform float u_mix;
uniform float u_time;
uniform vec2 u_resolution;

const float TAU = 6.28318530718;

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec3 base = texture(u_tex, v_uv).rgb;
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  float radius = mix(1.0, 5.0, clamp(u_smoothing, 0.0, 1.0));
  vec2 stepX = vec2(px.x * radius, 0.0);
  vec2 stepY = vec2(0.0, px.y * radius);

  vec3 prevCenter = texture(u_prev_frame, v_uv).rgb;
  float prevLeft = luma(texture(u_prev_frame, v_uv - stepX).rgb);
  float prevRight = luma(texture(u_prev_frame, v_uv + stepX).rgb);
  float prevUp = luma(texture(u_prev_frame, v_uv - stepY).rgb);
  float prevDown = luma(texture(u_prev_frame, v_uv + stepY).rgb);
  vec2 grad = vec2(prevRight - prevLeft, prevDown - prevUp);

  float freq = mix(0.8, 8.0, clamp(u_ratio / 8.0, 0.0, 1.0));
  float phaseA = TAU * (v_uv.y * freq + u_time * 0.12 * u_ratio + luma(prevCenter) * 0.3);
  float phaseB = TAU * (v_uv.x * freq * 1.17 - u_time * 0.09 * u_ratio + luma(prevCenter) * 0.2);
  vec2 field = vec2(sin(phaseA), cos(phaseB));
  float toneBias = mix(0.35, 1.25, clamp(u_tone, 0.0, 1.0));

  float depth = u_amount * mix(0.003, 0.045, clamp(u_index, 0.0, 1.0));
  vec2 displacement = (grad * (0.5 + toneBias * 0.45) + field * (0.22 + toneBias * 0.18)) * depth;
  vec2 warpedUv = clamp(v_uv + displacement, vec2(0.0), vec2(1.0));

  vec3 warped = texture(u_tex, warpedUv).rgb;
  vec3 echoed = mix(warped, prevCenter, clamp(u_feedback, 0.0, 1.0) * 0.55);
  vec3 finalColor = mix(base, echoed, clamp(u_mix, 0.0, 1.0));
  outColor = vec4(finalColor, 1.0);
}
