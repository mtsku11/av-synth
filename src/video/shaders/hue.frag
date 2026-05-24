#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_amount;

vec3 rotateHue(vec3 rgb, float radians) {
  float c = cos(radians);
  float s = sin(radians);
  float k = (1.0 - c) / 3.0;
  float sq = sqrt(1.0 / 3.0) * s;
  // GLSL mat3() takes columns, so this is the row-major rotation
  // [[c+k, k-sq, k+sq], [k+sq, c+k, k-sq], [k-sq, k+sq, c+k]] transposed
  // into columns, which gives a positive-direction R→G→B hue rotation
  // for positive `radians`.
  mat3 m = mat3(
    c + k, k + sq, k - sq,
    k - sq, c + k, k + sq,
    k + sq, k - sq, c + k
  );
  return m * rgb;
}

void main() {
  vec4 c = texture(u_tex, v_uv);
  vec3 rgb = rotateHue(c.rgb, u_amount * 6.283185307179586);
  o_color = vec4(rgb, c.a);
}
