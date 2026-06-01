#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform sampler2D u_prev_frame;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scanlines;
uniform float u_mask;
uniform float u_warp;
uniform float u_bleed;
uniform float u_phosphor;
uniform float u_noise;
uniform float u_roll;
uniform float u_vhs_dist;
uniform float u_vhs_tape;
uniform float u_mix;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 warpUv(vec2 uv, float warp) {
  vec2 centered = uv * 2.0 - 1.0;
  float radius = dot(centered, centered);
  centered *= 1.0 + radius * warp * 0.22;
  return centered * 0.5 + 0.5;
}

// ---- VHS Distortion helpers ----
float vhsNoise(vec2 p) {
  vec2 q = fract(p * 0.5 + vec2(u_time * 0.23, cos(u_time) * 0.17));
  float s = hash12(floor(q * 64.0) / 64.0 + vec2(u_time * 0.31, 0.0));
  return s * s;
}

float onOff(float a, float b, float c) {
  return step(c, sin(u_time + a * cos(u_time * b)));
}

// ---- VHS Tape helpers ----
float tapeHash(vec2 p) {
  return hash12(p * 0.3183099 + vec2(0.71, 0.113));
}

float iHash(vec2 v, vec2 r) {
  float h00 = tapeHash(floor(v * r + vec2(0.0, 0.0)) / r);
  float h10 = tapeHash(floor(v * r + vec2(1.0, 0.0)) / r);
  float h01 = tapeHash(floor(v * r + vec2(0.0, 1.0)) / r);
  float h11 = tapeHash(floor(v * r + vec2(1.0, 1.0)) / r);
  vec2 ip = smoothstep(vec2(0.0), vec2(1.0), mod(v * r, 1.0));
  return (h00 * (1.0 - ip.x) + h10 * ip.x) * (1.0 - ip.y)
       + (h01 * (1.0 - ip.x) + h11 * ip.x) * ip.y;
}

float tapNoise(vec2 v) {
  float sum = 0.0;
  float scale = 4.0;
  float weight = 0.5;
  for (int i = 1; i < 9; i++) {
    sum += iHash(v + vec2(float(i)), vec2(scale)) * weight;
    scale *= 2.0;
    weight *= 0.5;
  }
  return sum;
}

void main() {
  vec4 src = texture(u_tex, v_uv);

  // Roll
  vec2 rolledUv = v_uv;
  rolledUv.y = fract(rolledUv.y + u_time * u_roll * 0.04);

  vec2 baseUv = rolledUv;

  // ---- VHS Tape UV warp ----
  float tcPhase = 0.0;
  float snPhase = 0.0;
  if (u_vhs_tape > 0.001) {
    float PI = 3.14159265;
    vec2 uvt = baseUv;
    uvt.x += (tapNoise(vec2(uvt.y, u_time)) - 0.5) * 0.005;
    uvt.x += (tapNoise(vec2(uvt.y * 100.0, u_time * 10.0)) - 0.5) * 0.01;
    tcPhase = clamp(
      (sin(uvt.y * 8.0 - u_time * PI * 1.2) - 0.92) * tapNoise(vec2(u_time)),
      0.0, 0.01) * 10.0;
    float tcNoise = max(tapNoise(vec2(uvt.y * 100.0, u_time * 10.0)) - 0.5, 0.0);
    uvt.x -= tcNoise * tcPhase;
    snPhase = smoothstep(0.03, 0.0, uvt.y);
    uvt.y += snPhase * 0.3;
    uvt.x += snPhase * ((tapNoise(vec2(baseUv.y * 100.0, u_time * 10.0)) - 0.5) * 0.2);
    baseUv = mix(baseUv, uvt, u_vhs_tape);
  }

  // ---- VHS Distortion UV warp ----
  if (u_vhs_dist > 0.001) {
    vec2 uvd = baseUv;
    float window = 1.0 / (1.0 + 20.0
      * (uvd.y - mod(u_time / 4.0, 1.0))
      * (uvd.y - mod(u_time / 4.0, 1.0)));
    float dx = sin(uvd.y * 10.0 + u_time) / 50.0
      * onOff(4.0, 4.0, 0.3) * (1.0 + cos(u_time * 80.0)) * window;
    float vShift = 0.4 * onOff(2.0, 3.0, 0.9)
      * (sin(u_time) * sin(u_time * 20.0)
       + (0.5 + 0.1 * sin(u_time * 200.0) * cos(u_time)));
    uvd.x += dx;
    uvd.y = mod(uvd.y + vShift, 1.0);
    baseUv = mix(baseUv, uvd, u_vhs_dist);
  }

  // ---- CRT barrel warp ----
  vec2 uv = warpUv(baseUv, u_warp);
  vec2 px = max(vec2(1.0) / max(u_resolution, vec2(1.0)), vec2(1e-5));

  float inside = step(0.0, uv.x) * step(0.0, uv.y) * step(uv.x, 1.0) * step(uv.y, 1.0);

  // ---- Sample with horizontal bleed ----
  vec3 base = texture(u_tex, clamp(uv, 0.0, 1.0)).rgb;
  float bleedPx = u_bleed * 2.8;
  vec3 triad = vec3(
    texture(u_tex, clamp(uv + vec2(bleedPx * px.x, 0.0), 0.0, 1.0)).r,
    texture(u_tex, clamp(uv, 0.0, 1.0)).g,
    texture(u_tex, clamp(uv - vec2(bleedPx * px.x, 0.0), 0.0, 1.0)).b
  );
  vec3 color = mix(base, triad, clamp(u_bleed, 0.0, 1.0) * 0.75);

  // ---- Scanlines ----
  float linePhase = uv.y * u_resolution.y * 3.14159265;
  float scanlineMask = 0.78 + 0.22 * cos(linePhase);
  color *= mix(1.0, scanlineMask, clamp(u_scanlines, 0.0, 1.0));

  // ---- RGB triad mask ----
  float triadIndex = mod(floor(uv.x * u_resolution.x), 3.0);
  vec3 maskColor = triadIndex < 1.0
    ? vec3(1.0, 0.84, 0.76)
    : triadIndex < 2.0
      ? vec3(0.78, 1.0, 0.86)
      : vec3(0.82, 0.88, 1.0);
  color *= mix(vec3(1.0), maskColor, clamp(u_mask, 0.0, 1.0) * 0.32);

  // ---- Phosphor / prev-frame persistence ----
  vec3 phosphorBlur =
    texture(u_tex, clamp(uv + vec2(0.0,  px.y), 0.0, 1.0)).rgb * 0.25 +
    texture(u_tex, clamp(uv - vec2(0.0,  px.y), 0.0, 1.0)).rgb * 0.25;
  vec3 prev = texture(u_prev_frame, clamp(uv, 0.0, 1.0)).rgb;
  color = mix(color, max(color, phosphorBlur + prev * 0.92), clamp(u_phosphor, 0.0, 1.0) * 0.4);

  // ---- CRT noise ----
  float noiseVal = hash12(floor(uv * u_resolution) + vec2(u_time * 31.0, u_time * 19.0)) - 0.5;
  color += vec3(noiseVal) * (u_noise * 0.06);
  color *= inside;

  // ---- VHS Tape colour effects ----
  if (u_vhs_tape > 0.001) {
    // Horizontal chroma bloom smear
    vec3 bloom = vec3(0.0);
    for (float x = -4.0; x < 2.5; x += 1.0) {
      bloom.r += texture(u_tex, clamp(uv + vec2((x - 0.0) * 7e-3, 0.0), 0.0, 1.0)).r;
      bloom.g += texture(u_tex, clamp(uv + vec2((x - 2.0) * 7e-3, 0.0), 0.0, 1.0)).g;
      bloom.b += texture(u_tex, clamp(uv + vec2((x - 4.0) * 7e-3, 0.0), 0.0, 1.0)).b;
    }
    bloom *= 0.1;
    color = mix(color, (color + bloom) * 0.6, u_vhs_tape);

    // Tape crease darkening
    color *= mix(1.0, 1.0 - tcPhase, u_vhs_tape);

    // Switching noise colour channel rotation (bottom edge)
    color = mix(color, color.yzx, snPhase * u_vhs_tape);

    // AC beat — rolling luminance band
    float acBeat = 1.0 + clamp(tapNoise(vec2(0.0, v_uv.y + u_time * 0.2)) * 0.6 - 0.25, 0.0, 0.1);
    color *= mix(1.0, acBeat, u_vhs_tape);
  }

  // ---- VHS Distortion stripe overlay ----
  if (u_vhs_dist > 0.001) {
    float stripeNoise = vhsNoise(uv * vec2(0.5, 1.0) + vec2(1.0, 3.0));
    float y = mod(uv.y * 4.0 + u_time * 0.5 + sin(u_time + sin(u_time * 0.63)), 1.0);
    float inside_strip = step(0.5, y) - step(0.6, y);
    float stripeFact = (y - 0.5) / 0.1 * inside_strip;
    float stripe = (1.0 - stripeFact) * inside_strip * stripeNoise;
    color += vec3(stripe) * u_vhs_dist * 0.3;
  }

  // ---- Final mix ----
  vec3 outColor = mix(src.rgb, clamp(color, 0.0, 1.0), clamp(u_mix, 0.0, 1.0));
  o_color = vec4(outColor, src.a);
}
