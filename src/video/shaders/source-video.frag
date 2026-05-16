#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o_color;
uniform sampler2D u_videoTex;

void main() {
  // <video> textures arrive flipped; correct here so subsequent ops see
  // canvas-space orientation.
  o_color = texture(u_videoTex, vec2(v_uv.x, 1.0 - v_uv.y));
}
