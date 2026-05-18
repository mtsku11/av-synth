#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_amount;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -0.3333333, 0.6666667, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 0.6666667, 0.3333333, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec4 c = texture(u_tex, v_uv);
  vec3 hsv = rgb2hsv(c.rgb);
  hsv.y = clamp(hsv.y * u_amount, 0.0, 1.0);
  o_color = vec4(hsv2rgb(hsv), c.a);
}
