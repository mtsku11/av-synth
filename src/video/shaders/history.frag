#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform float u_feedback_amount;

vec3 sampleColor(vec2 uv) {
  return texture(u_tex, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  vec3 base = sampleColor(v_uv);
  vec3 blur =
      base * 0.32 +
      sampleColor(v_uv + vec2(px.x, 0.0)) * 0.14 +
      sampleColor(v_uv - vec2(px.x, 0.0)) * 0.14 +
      sampleColor(v_uv + vec2(0.0, px.y)) * 0.14 +
      sampleColor(v_uv - vec2(0.0, px.y)) * 0.14 +
      sampleColor(v_uv + px) * 0.06 +
      sampleColor(v_uv - px) * 0.06;

  float polish = clamp(u_feedback_amount, 0.0, 0.95);
  vec3 color = mix(base, blur, polish * 0.24);
  float peak = max(max(color.r, color.g), color.b);
  color /= 1.0 + peak * polish * 0.18;

  o_color = vec4(clamp(color, 0.0, 1.0), 1.0);
}
