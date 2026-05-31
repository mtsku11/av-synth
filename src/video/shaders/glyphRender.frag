#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform vec3 u_audio_bands;
uniform float u_mode;
uniform float u_cell_size;
uniform float u_density;
uniform float u_contrast;
uniform float u_invert;
uniform float u_color_mode;
uniform float u_mix;

float luma(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

float boxMask(vec2 p, vec2 halfSize) {
  vec2 d = abs(p) - halfSize;
  return 1.0 - smoothstep(0.0, 0.075, max(d.x, d.y));
}

float circleMask(vec2 p, float radius) {
  return 1.0 - smoothstep(radius - 0.055, radius + 0.055, length(p));
}

float lineMask(vec2 p, vec2 a, vec2 b, float width) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return 1.0 - smoothstep(width - 0.045, width + 0.045, length(pa - ba * h));
}

float asciiMask(float level, vec2 p) {
  if (level < 0.5) return 0.0;
  if (level < 1.5) return circleMask(p - vec2(0.0, -0.32), 0.1);
  if (level < 2.5) return boxMask(p, vec2(0.32, 0.055));
  if (level < 3.5) {
    return max(circleMask(p - vec2(0.0, 0.22), 0.09), circleMask(p - vec2(0.0, -0.22), 0.09));
  }
  if (level < 4.5) {
    return max(boxMask(p - vec2(0.0, 0.17), vec2(0.31, 0.05)), boxMask(p + vec2(0.0, 0.17), vec2(0.31, 0.05)));
  }
  if (level < 5.5) {
    return max(boxMask(p, vec2(0.32, 0.055)), boxMask(p, vec2(0.055, 0.34)));
  }
  if (level < 6.5) {
    return max(
      max(boxMask(p, vec2(0.33, 0.05)), boxMask(p, vec2(0.05, 0.35))),
      max(lineMask(p, vec2(-0.27, -0.27), vec2(0.27, 0.27), 0.045), lineMask(p, vec2(-0.27, 0.27), vec2(0.27, -0.27), 0.045))
    );
  }
  if (level < 7.5) {
    return max(
      max(boxMask(p - vec2(-0.15, 0.0), vec2(0.045, 0.37)), boxMask(p - vec2(0.15, 0.0), vec2(0.045, 0.37))),
      max(boxMask(p - vec2(0.0, -0.15), vec2(0.35, 0.045)), boxMask(p - vec2(0.0, 0.15), vec2(0.35, 0.045)))
    );
  }
  if (level < 8.5) {
    return max(
      max(circleMask(p - vec2(-0.22, 0.22), 0.11), circleMask(p - vec2(0.22, -0.22), 0.11)),
      lineMask(p, vec2(-0.3, -0.34), vec2(0.3, 0.34), 0.045)
    );
  }
  return max(circleMask(p, 0.37) - circleMask(p, 0.24), max(circleMask(p - vec2(0.06, 0.02), 0.1), boxMask(p - vec2(0.28, -0.24), vec2(0.12, 0.05))));
}

vec3 palette(float tone) {
  vec3 dark = vec3(0.015, 0.055, 0.08);
  vec3 mid = vec3(0.12, 0.72, 0.62);
  vec3 light = vec3(1.0, 0.72, 0.24);
  return tone < 0.55
    ? mix(dark, mid, tone / 0.55)
    : mix(mid, light, (tone - 0.55) / 0.45);
}

void main() {
  vec3 dry = texture(u_tex, v_uv).rgb;
  vec2 grid = max(vec2(1.0), u_resolution / max(u_cell_size, 4.0));
  vec2 cell = floor(v_uv * grid);
  vec2 centerUv = (cell + 0.5) / grid;
  vec2 local = fract(v_uv * grid) - 0.5;
  vec3 source = texture(u_tex, centerUv).rgb;
  float tone = clamp((luma(source) - 0.5) * max(u_contrast, 0.05) + 0.5, 0.0, 1.0);
  if (u_invert > 0.5) tone = 1.0 - tone;
  float occupancy = smoothstep(max(0.0, 1.0 - u_density), 1.0, tone);

  float mode = floor(u_mode + 0.5);
  float mask;
  if (mode < 0.5) {
    mask = asciiMask(floor(occupancy * 9.99), local);
  } else if (mode < 1.5) {
    float zero = circleMask(local, 0.31) - circleMask(local, 0.19);
    float one = max(boxMask(local - vec2(0.0, -0.04), vec2(0.065, 0.34)), boxMask(local - vec2(0.0, -0.34), vec2(0.18, 0.045)));
    mask = occupancy < 0.5 ? zero * step(0.12, tone) : one;
  } else if (mode < 2.5) {
    mask = boxMask(local, vec2(mix(0.12, 0.46, occupancy), mix(0.08, 0.46, occupancy)));
  } else {
    mask = circleMask(local, mix(0.035, 0.46, occupancy));
  }

  float colorMode = floor(u_color_mode + 0.5);
  vec3 glyphColor = source;
  if (colorMode > 0.5 && colorMode < 1.5) glyphColor = vec3(tone);
  if (colorMode > 1.5 && colorMode < 2.5) glyphColor = palette(tone);
  if (colorMode > 2.5) {
    glyphColor = clamp(vec3(0.35, 0.52, 0.72) + u_audio_bands * vec3(1.1, 0.9, 1.25), 0.0, 1.35) * (0.28 + tone * 0.92);
  }

  vec3 wet = glyphColor * clamp(mask, 0.0, 1.0);
  o_color = vec4(mix(dry, wet, clamp(u_mix, 0.0, 1.0)), 1.0);
}
