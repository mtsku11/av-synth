#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_tex_b;
uniform float u_amount;
uniform float u_threshold;
uniform float u_tolerance;
uniform float u_invert;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 primary = texture(u_tex, v_uv);
  vec4 secondary = texture(u_tex_b, v_uv);
  float matte = max(secondary.a, luma(secondary.rgb));
  float t = max(u_tolerance, 1e-4);
  float key = smoothstep(u_threshold - t, u_threshold + t, matte);
  key = mix(key, 1.0 - key, clamp(u_invert, 0.0, 1.0));
  float alpha = clamp(key * u_amount, 0.0, 1.0);
  vec3 rgb = mix(primary.rgb, secondary.rgb, alpha);
  float outAlpha = max(primary.a, alpha);
  o_color = vec4(rgb, outAlpha);
}
