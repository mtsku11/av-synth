#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_mix;
uniform float u_strength;
uniform float u_macroBalance;
uniform float u_macroSoftness;
uniform float u_microSoftness;
uniform int u_macro_count;
uniform int u_micro_count;

uniform vec4 u_macro[16];
uniform vec4 u_micro[64];

vec2 biotSavart(vec2 uv, vec4 v, float soft) {
  vec2 d = v.xy - uv;
  d -= floor(d + 0.5);
  float r2 = dot(d, d) + soft;
  return vec2(-d.y, d.x) * v.z / r2;
}

void main() {
  vec2 vel = vec2(0.0);
  float softMacro = u_macroSoftness * u_macroSoftness + 1e-4;
  float softMicro = u_microSoftness * u_microSoftness + 1e-4;
  float macroGain = clamp(u_macroBalance, 0.0, 1.0);
  float microGain = 1.0 - macroGain;

  // Macro band — few strong slow swirls that anchor the composition.
  for (int i = 0; i < 16; i++) {
    if (i >= u_macro_count) break;
    vel += biotSavart(v_uv, u_macro[i], softMacro) * macroGain;
  }
  // Micro band — many small fast eddies that decorate the macro flow.
  for (int i = 0; i < 64; i++) {
    if (i >= u_micro_count) break;
    vel += biotSavart(v_uv, u_micro[i], softMicro) * microGain * 0.35;
  }

  vec2 src_uv = fract(v_uv - vel * u_strength);
  vec3 displaced = texture(u_tex, src_uv).rgb;
  vec3 current = texture(u_tex, v_uv).rgb;
  o_color = vec4(mix(current, displaced, clamp(u_mix, 0.0, 1.0)), 1.0);
}
