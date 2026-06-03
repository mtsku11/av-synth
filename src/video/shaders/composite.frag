#version 300 es
precision highp float;

// composite — unified binary blend operator.
// Replaces add / sub / mult / diff / blend / layer / mask.
//
// u_mode:
//   0 = add      primary + secondary * amount
//   1 = sub      primary - secondary * amount
//   2 = mult     primary * mix(1, secondary, amount)
//   3 = diff     |primary - secondary| mix
//   4 = over     linear crossfade
//   5 = screen   1 - (1-a)(1-b)
//   6 = layer    luminance-keyed over  (uses threshold/tolerance/invert)
//   7 = mask     luminance gate        (uses threshold/tolerance/invert)

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_tex_b;
uniform int   u_mode;
uniform float u_amount;
uniform float u_threshold;
uniform float u_tolerance;
uniform float u_invert;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 a = texture(u_tex,   v_uv);
  vec4 b = texture(u_tex_b, v_uv);
  float m = clamp(u_amount, 0.0, 1.0);
  vec4 result;

  if (u_mode == 0) {
    result = a + b * m;
  } else if (u_mode == 1) {
    result = a - b * m;
  } else if (u_mode == 2) {
    result = a * mix(vec4(1.0), b, m);
  } else if (u_mode == 3) {
    result = mix(a, abs(a - b), m);
  } else if (u_mode == 4) {
    result = mix(a, b, m);
  } else if (u_mode == 5) {
    vec4 s = 1.0 - (1.0 - a) * (1.0 - b);
    result = mix(a, s, m);
  } else if (u_mode == 6) {
    float matte = max(b.a, luma(b.rgb));
    float t = max(u_tolerance, 1e-4);
    float key = smoothstep(u_threshold - t, u_threshold + t, matte);
    key = mix(key, 1.0 - key, clamp(u_invert, 0.0, 1.0));
    float alpha = clamp(key * m, 0.0, 1.0);
    result = vec4(mix(a.rgb, b.rgb, alpha), max(a.a, alpha));
  } else {
    // mask
    float matte = max(b.a, luma(b.rgb));
    float t = max(u_tolerance, 1e-4);
    float gate = smoothstep(u_threshold - t, u_threshold + t, matte);
    gate = mix(gate, 1.0 - gate, clamp(u_invert, 0.0, 1.0));
    result = mix(a, a * gate, m);
  }

  o_color = result;
}
