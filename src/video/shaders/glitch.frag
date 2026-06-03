#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_time;
uniform float u_type;    // 0=signal, 1=shift, 2=fract
uniform float u_amount;  // 0=bypass for all modes

// signal mode params
uniform float u_displace;
uniform float u_block;
uniform float u_damage;
uniform float u_quantize;
uniform float u_tint;
uniform float u_overlay;
uniform float u_jitter;

// fract mode param
uniform float u_scale;

const float TAU = 6.28318530718;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float bayer4(vec2 px) {
  vec2 cell = mod(floor(px), 4.0);
  if (cell.y < 1.0) {
    if (cell.x < 1.0) return 0.0 / 16.0;
    if (cell.x < 2.0) return 8.0 / 16.0;
    if (cell.x < 3.0) return 2.0 / 16.0;
    return 10.0 / 16.0;
  }
  if (cell.y < 2.0) {
    if (cell.x < 1.0) return 12.0 / 16.0;
    if (cell.x < 2.0) return 4.0 / 16.0;
    if (cell.x < 3.0) return 14.0 / 16.0;
    return 6.0 / 16.0;
  }
  if (cell.y < 3.0) {
    if (cell.x < 1.0) return 3.0 / 16.0;
    if (cell.x < 2.0) return 11.0 / 16.0;
    if (cell.x < 3.0) return 1.0 / 16.0;
    return 9.0 / 16.0;
  }
  if (cell.x < 1.0) return 15.0 / 16.0;
  if (cell.x < 2.0) return 7.0 / 16.0;
  if (cell.x < 3.0) return 13.0 / 16.0;
  return 5.0 / 16.0;
}

vec3 overlayBlend(vec3 base, vec3 blend) {
  vec3 low = 2.0 * base * blend;
  vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
  return mix(low, high, step(vec3(0.5), base));
}

float lumaVal(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec4 src = texture(u_tex, v_uv);

  if (u_type < 0.5) {
    // signal damage — u_amount is the wet/dry mix
    if (u_amount < 0.0005) {
      o_color = src;
      return;
    }
    vec2 resolution = vec2(textureSize(u_tex, 0));
    vec2 px = 1.0 / max(resolution, vec2(1.0));
    vec2 fragPx = v_uv * resolution;
    float blockPx = max(8.0, u_block);
    vec2 blockId = floor(fragPx / blockPx);

    float jitterRate = mix(1.5, 18.0, clamp(u_jitter, 0.0, 1.0));
    float timeCell = floor(u_time * jitterRate);
    float blockNoise = hash12(blockId + vec2(timeCell * 0.97, timeCell * 0.31));
    float blockNoise2 = hash12(blockId.yx * vec2(1.17, 0.93) + vec2(timeCell * 0.43, -timeCell * 0.27));
    float rowNoise = hash12(vec2(blockId.y, floor(u_time * mix(2.0, 14.0, clamp(u_jitter, 0.0, 1.0)))));

    float scan =
      sin(v_uv.y * resolution.y * (0.028 + rowNoise * 0.042) + u_time * (10.0 + 24.0 * u_jitter) + blockNoise2 * TAU);
    float burstSeed = blockNoise * 0.75 + blockNoise2 * 0.45 + scan * 0.25;
    float damageGate = smoothstep(0.52 - u_damage * 0.28, 0.96 - u_damage * 0.08, burstSeed);
    float maskStrength = clamp(u_damage * 1.15 + u_displace * 0.6 + u_jitter * 0.45, 0.0, 1.0);
    float damageMask = clamp(damageGate * maskStrength, 0.0, 1.0);

    float lineOffsetPx = scan * (3.0 + 12.0 * u_jitter) * (0.2 + u_displace);
    float burstOffsetPx = (blockNoise2 * 2.0 - 1.0) * (2.0 + 10.0 * u_displace);
    float verticalOffsetPx = (rowNoise * 2.0 - 1.0) * u_displace * 2.5;
    vec2 offsetPx = vec2(lineOffsetPx + burstOffsetPx, verticalOffsetPx) * damageMask;
    vec2 damageUv = clamp(v_uv + offsetPx * px, 0.0, 1.0);

    float chromaPx = (0.5 + blockNoise * 1.8) * (0.4 + u_damage * 2.6) * damageMask;
    vec2 chromaOffset = vec2(chromaPx * px.x, 0.0);
    vec3 shifted = vec3(
      texture(u_tex, clamp(damageUv + chromaOffset, 0.0, 1.0)).r,
      texture(u_tex, damageUv).g,
      texture(u_tex, clamp(damageUv - chromaOffset, 0.0, 1.0)).b
    );
    vec3 displaced = mix(texture(u_tex, damageUv).rgb, shifted, clamp(u_damage * 0.7 + u_displace * 0.3, 0.0, 1.0));

    float ordered = bayer4(fragPx / max(1.0, blockPx * 0.25));
    float levels = mix(28.0, 4.0, clamp(u_quantize, 0.0, 1.0));
    vec3 quant = displaced * levels;
    float threshold = mix(1.0, ordered, clamp(u_damage, 0.0, 1.0));
    quant = floor(quant + step(vec3(threshold), fract(quant))) / levels;
    vec3 damaged = mix(displaced, quant, damageMask * clamp(u_quantize, 0.0, 1.0));

    vec3 tintColor = mix(vec3(1.0), vec3(0.15, 0.29, 0.39), clamp(u_tint, 0.0, 1.0));
    vec3 tinted = mix(damaged, damaged * tintColor + vec3(0.02, 0.02, 0.03), damageMask * clamp(u_tint, 0.0, 1.0) * 0.72);
    vec3 overlayTarget = overlayBlend(tinted, mix(vec3(0.52), vec3(0.15, 0.29, 0.39), clamp(u_tint, 0.0, 1.0)));
    vec3 processed = mix(tinted, overlayTarget, damageMask * clamp(u_overlay, 0.0, 1.0));
    float wash = damageMask * (u_tint * 0.24 + u_quantize * 0.12);
    processed = mix(vec3(lumaVal(processed)), processed, clamp(1.0 - wash, 0.0, 1.0));

    processed *= 1.0 - damageMask * u_damage * 0.18;
    processed = clamp(processed, 0.0, 1.0);

    o_color = vec4(mix(src.rgb, processed, clamp(u_amount, 0.0, 1.0)), src.a);

  } else if (u_type < 1.5) {
    // chromaShift — u_amount scales the UV offset into [0, 0.08]
    vec2 d = vec2(u_amount * 0.08, 0.0);
    float r = texture(u_tex, v_uv + d).r;
    float g = texture(u_tex, v_uv).g;
    float b = texture(u_tex, v_uv - d).b;
    o_color = vec4(r, g, b, 1.0);

  } else {
    // chromaFract — u_amount is the wet/dry mix
    if (u_amount < 0.0005) {
      o_color = vec4(src.rgb, 1.0);
      return;
    }
    vec3 c = sqrt(src.rgb);
    float lm = (c.r + c.g + c.b) / 3.0;
    vec3 result = fract(u_scale * (c - lm));
    result *= result;
    o_color = vec4(mix(src.rgb, result, u_amount), 1.0);
  }
}
