#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform float u_sharpness;
uniform float u_scale;
uniform float u_edge_protect;
uniform float u_mix;

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 src = texture(u_tex, v_uv);
  vec2 px = max(vec2(1.0) / max(u_resolution, vec2(1.0)), vec2(1e-5));
  vec2 stepPx = px * max(u_scale, 0.35);

  vec3 north = texture(u_tex, clamp(v_uv + vec2(0.0, -stepPx.y), 0.0, 1.0)).rgb;
  vec3 south = texture(u_tex, clamp(v_uv + vec2(0.0, stepPx.y), 0.0, 1.0)).rgb;
  vec3 east = texture(u_tex, clamp(v_uv + vec2(stepPx.x, 0.0), 0.0, 1.0)).rgb;
  vec3 west = texture(u_tex, clamp(v_uv + vec2(-stepPx.x, 0.0), 0.0, 1.0)).rgb;

  vec3 blur = (src.rgb * 4.0 + north + south + east + west) / 8.0;
  vec3 detail = src.rgb - blur;
  float edge = abs(luma(detail));
  float protection = 1.0 / (1.0 + u_edge_protect * 18.0 * edge);

  vec3 clarified = clamp(src.rgb + detail * u_sharpness * protection, 0.0, 1.0);
  vec3 outColor = mix(src.rgb, clarified, clamp(u_mix, 0.0, 1.0));
  o_color = vec4(outColor, src.a);
}
