#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform vec3 u_audio_bands;
uniform float u_time;
uniform float u_rain_speed;
uniform float u_column_density;
uniform float u_glyph_change_rate;
uniform float u_trail_length;
uniform float u_source_color_blend;
uniform float u_audio_react;
uniform float u_mix;

float hash12(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float boxMask(vec2 p, vec2 halfSize) {
  vec2 d = abs(p) - halfSize;
  return 1.0 - smoothstep(0.0, 0.09, max(d.x, d.y));
}

void main() {
  vec3 dry = texture(u_tex, v_uv).rgb;
  float columns = mix(14.0, 120.0, clamp(u_column_density, 0.0, 1.0));
  float rows = columns * u_resolution.y / max(u_resolution.x, 1.0) * 1.65;
  vec2 grid = vec2(columns, max(8.0, rows));
  vec2 cell = floor(v_uv * grid);
  vec2 local = fract(v_uv * grid) - 0.5;
  vec2 centerUv = (cell + 0.5) / grid;
  vec3 source = texture(u_tex, centerUv).rgb;
  float sourceLuma = dot(source, vec3(0.2126, 0.7152, 0.0722));

  float bandEnergy = dot(u_audio_bands, vec3(0.52, 0.32, 0.16));
  float speed = mix(0.06, 1.5, clamp(u_rain_speed, 0.0, 1.0)) * (1.0 + bandEnergy * u_audio_react);
  float head = fract(hash12(vec2(cell.x, 7.0)) + u_time * speed);
  float row = cell.y / grid.y;
  float behindHead = mod(head - row, 1.0);
  float trail = exp(-behindHead / mix(0.018, 0.34, clamp(u_trail_length, 0.0, 1.0)));
  float change = floor(u_time * mix(1.0, 28.0, clamp(u_glyph_change_rate, 0.0, 1.0)));
  float symbol = hash12(cell + vec2(change, cell.x * 0.13));
  float liveCell = step(0.34 - sourceLuma * 0.24 - bandEnergy * u_audio_react * 0.18, symbol);

  float digit = symbol > 0.5
    ? max(boxMask(local, vec2(0.07, 0.34)), boxMask(local - vec2(0.0, -0.32), vec2(0.18, 0.045)))
    : max(
        max(boxMask(local - vec2(0.0, 0.28), vec2(0.2, 0.045)), boxMask(local - vec2(0.0, -0.28), vec2(0.2, 0.045))),
        max(boxMask(local - vec2(-0.17, 0.0), vec2(0.045, 0.28)), boxMask(local - vec2(0.17, 0.0), vec2(0.045, 0.28)))
      );
  float glow = clamp(trail * liveCell * (0.54 + sourceLuma * 0.86 + bandEnergy * u_audio_react), 0.0, 1.4);
  vec3 terminal = vec3(0.035, 0.94, 0.36) * glow;
  vec3 sourceTint = source * (0.2 + glow * 1.1);
  vec3 glyphColor = mix(terminal, sourceTint, clamp(u_source_color_blend, 0.0, 1.0));
  vec3 wet = max(dry * 0.12, glyphColor * digit);
  o_color = vec4(mix(dry, wet, clamp(u_mix, 0.0, 1.0)), 1.0);
}
