#version 300 es

// Grain voice fragment — sample the TEXTURE_2D_ARRAY at the layer chosen by the scheduler,
// then output premultiplied RGBA modulated by the envelope alpha. Caller is expected to use
// blendFuncSeparate(ONE, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA) so successive voices
// composite correctly over an opaque clear (0,0,0,1) background.

precision highp float;
precision highp sampler2DArray;

in vec2 v_uv;
in float v_layer;
in float v_alpha;
out vec4 fragColor;

uniform sampler2DArray u_grain;

void main() {
  // GrainBuffer uploads with UNPACK_FLIP_Y_WEBGL=false, so the image's top row
  // is stored at texture y=0 (GL sampler t=0 = texture bottom). Flip v_uv.y on
  // sample so the quad renders right-side up.
  vec3 rgb = texture(u_grain, vec3(v_uv.x, 1.0 - v_uv.y, v_layer)).rgb;
  fragColor = vec4(rgb * v_alpha, v_alpha);
}
