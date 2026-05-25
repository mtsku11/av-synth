#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_tex;
uniform vec2 u_resolution;
uniform float u_prev_valid;

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

float sampleLuma(vec2 uv) {
  return luma(texture(u_tex, clamp(uv, 0.0, 1.0)).rgb);
}

void main() {
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  float center = sampleLuma(v_uv);

  float tl = sampleLuma(v_uv + vec2(-px.x, -px.y));
  float tc = sampleLuma(v_uv + vec2(0.0, -px.y));
  float tr = sampleLuma(v_uv + vec2(px.x, -px.y));
  float ml = sampleLuma(v_uv + vec2(-px.x, 0.0));
  float mr = sampleLuma(v_uv + vec2(px.x, 0.0));
  float bl = sampleLuma(v_uv + vec2(-px.x, px.y));
  float bc = sampleLuma(v_uv + vec2(0.0, px.y));
  float br = sampleLuma(v_uv + vec2(px.x, px.y));

  float sobelX = tr + 2.0 * mr + br - (tl + 2.0 * ml + bl);
  float sobelY = bl + 2.0 * bc + br - (tl + 2.0 * tc + tr);
  float edge = clamp(length(vec2(sobelX, sobelY)) * 0.28, 0.0, 1.0);

  float prevLuma = u_prev_valid > 0.5
    ? luma(texture(u_prev_tex, clamp(v_uv, 0.0, 1.0)).rgb)
    : center;
  float flux = clamp(abs(center - prevLuma) * 5.5, 0.0, 1.0);

  float contour = clamp(edge * (0.55 + smoothstep(0.24, 0.82, center) * 0.65) + flux * 0.25, 0.0, 1.0);

  o_color = vec4(center, edge, flux, contour);
}
