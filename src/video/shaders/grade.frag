#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_brightness; // [-1,1]  default 0  — identity at 0
uniform float u_contrast;   // [0,3]   default 1  — identity at 1
uniform float u_saturate;   // [0,3]   default 1  — identity at 1
uniform float u_hue;        // [-1,1]  default 0  — identity at 0

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

vec3 rotateHue(vec3 rgb, float radians) {
  float c = cos(radians);
  float s = sin(radians);
  float k = (1.0 - c) / 3.0;
  float sq = sqrt(1.0 / 3.0) * s;
  mat3 m = mat3(
    c + k, k + sq, k - sq,
    k - sq, c + k, k + sq,
    k + sq, k - sq, c + k
  );
  return m * rgb;
}

void main() {
  vec4 c = texture(u_tex, v_uv);
  c.rgb = clamp(c.rgb + u_brightness, 0.0, 1.0);
  c.rgb = clamp((c.rgb - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  vec3 hsv = rgb2hsv(c.rgb);
  hsv.y = clamp(hsv.y * u_saturate, 0.0, 1.0);
  c.rgb = hsv2rgb(hsv);
  c.rgb = rotateHue(c.rgb, u_hue * 6.283185307179586);
  o_color = c;
}
