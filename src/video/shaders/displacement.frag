#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_tex;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec4 u_config;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 sampleScene(vec2 uv) {
  return texture(u_tex, clamp(uv, 0.0, 1.0)).rgb;
}

void main() {
  vec2 px = 1.0 / max(u_resolution, vec2(1.0));
  float amountPx = u_config.x;
  float radiusPx = max(u_config.y, 1.0);
  float temporalMix = clamp(u_config.z, 0.0, 1.0);
  float chroma = clamp(u_config.w, 0.0, 1.0);
  vec2 sampleRadius = px * radiusPx;

  vec3 current = sampleScene(v_uv);
  vec3 previous = texture(u_prev_tex, clamp(v_uv, 0.0, 1.0)).rgb;
  vec3 centerMix = mix(current, previous, temporalMix * 0.65);
  float centerLuma = luma(centerMix);

  float lumaRight = luma(mix(
    sampleScene(v_uv + vec2(sampleRadius.x, 0.0)),
    texture(u_prev_tex, clamp(v_uv + vec2(sampleRadius.x, 0.0), 0.0, 1.0)).rgb,
    temporalMix
  ));
  float lumaLeft = luma(mix(
    sampleScene(v_uv - vec2(sampleRadius.x, 0.0)),
    texture(u_prev_tex, clamp(v_uv - vec2(sampleRadius.x, 0.0), 0.0, 1.0)).rgb,
    temporalMix
  ));
  float lumaUp = luma(mix(
    sampleScene(v_uv - vec2(0.0, sampleRadius.y)),
    texture(u_prev_tex, clamp(v_uv - vec2(0.0, sampleRadius.y), 0.0, 1.0)).rgb,
    temporalMix
  ));
  float lumaDown = luma(mix(
    sampleScene(v_uv + vec2(0.0, sampleRadius.y)),
    texture(u_prev_tex, clamp(v_uv + vec2(0.0, sampleRadius.y), 0.0, 1.0)).rgb,
    temporalMix
  ));

  vec2 gradient = vec2(lumaRight - lumaLeft, lumaDown - lumaUp);
  vec2 center = v_uv * 2.0 - 1.0;
  float radius = length(center);
  vec2 radial = radius > 0.0001 ? center / radius : vec2(0.0);
  vec2 shimmer = vec2(
    sin((v_uv.y * 9.0) + u_time * 0.7),
    cos((v_uv.x * 7.3) - u_time * 0.55)
  );
  vec2 displacement =
    (gradient * 1.75 + radial * centerLuma * 0.45 + shimmer * temporalMix * 0.12) *
    amountPx *
    px;
  vec2 displacedUv = clamp(v_uv + displacement, 0.0, 1.0);

  vec3 color = texture(u_tex, displacedUv).rgb;
  if (chroma > 0.001) {
    vec2 chromaOffset = displacement * (0.8 + chroma * 0.65);
    color = vec3(
      texture(u_tex, clamp(displacedUv + chromaOffset, 0.0, 1.0)).r,
      texture(u_tex, displacedUv).g,
      texture(u_tex, clamp(displacedUv - chromaOffset, 0.0, 1.0)).b
    );
  }

  o_color = vec4(color, 1.0);
}
