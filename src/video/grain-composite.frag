#version 300 es

// Grain voice fragment — sample the TEXTURE_2D_ARRAY at the layer chosen by the scheduler,
// then output premultiplied RGBA modulated by the envelope alpha.
//
// Blend mode is set by the caller:
//   composite (default): blendFuncSeparate(ONE, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA)
//   additive:            blendFunc(ONE, ONE)

precision highp float;
precision highp sampler2DArray;

in vec2 v_uv;
in vec2 v_quadPos;
in float v_layer;
in float v_alpha;
out vec4 fragColor;

uniform sampler2DArray u_grain;
// 0 = rectangular grain; >0 applies a soft circular mask.
// 1.0 = full radial gradient (transparent at edge, opaque at centre).
uniform float u_softness;

void main() {
  // GrainBuffer uploads with UNPACK_FLIP_Y_WEBGL=false, so the image's top row
  // is stored at texture y=0 (GL sampler t=0 = texture bottom). Flip v_uv.y on
  // sample so the quad renders right-side up.
  vec3 rgb = texture(u_grain, vec3(v_uv.x, 1.0 - v_uv.y, v_layer)).rgb;
  float alpha = v_alpha;
  // v_quadPos is in [-1,1]; length=1 is the inscribed circle edge.
  if (u_softness > 0.0) {
    float inner = max(0.0, 1.0 - u_softness);
    alpha *= 1.0 - smoothstep(inner, 1.0, length(v_quadPos));
  }
  fragColor = vec4(rgb * alpha, alpha);
}
