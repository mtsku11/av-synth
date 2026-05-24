#version 300 es

// Grain voice fragment — sample the TEXTURE_2D_ARRAY at the layer chosen by the scheduler,
// then output premultiplied RGBA modulated by the envelope alpha. Caller is expected to use
// blendFuncSeparate(ONE, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA) so successive voices
// composite correctly over an opaque clear (0,0,0,1) background.

precision highp float;
precision highp sampler2DArray;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2DArray u_grain;
uniform float u_layer;
uniform float u_alpha;

void main() {
  vec3 rgb = texture(u_grain, vec3(v_uv, u_layer)).rgb;
  fragColor = vec4(rgb * u_alpha, u_alpha);
}
