#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_mode;      // 0=luma, 1=thresh, 2=invert
uniform float u_amount;    // wet/dry; 0=bypass for all modes
uniform float u_threshold; // luma and thresh modes
uniform float u_tolerance; // luma and thresh modes
uniform float u_flip;      // luma mode: 1=flip bright-pass to dark-pass

void main() {
  vec4 c = texture(u_tex, v_uv);

  if (u_mode < 0.5) {
    // luma key
    float y = max(c.a, dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)));
    float t = max(u_tolerance, 1e-4);
    float key = smoothstep(u_threshold - t, u_threshold + t, y);
    key = mix(key, 1.0 - key, clamp(u_flip, 0.0, 1.0));
    float m = mix(1.0, key, clamp(u_amount, 0.0, 1.0));
    o_color = vec4(c.rgb * m, c.a * m);

  } else if (u_mode < 1.5) {
    // hard threshold
    float y = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    float t = max(u_tolerance, 1e-4);
    float v = smoothstep(u_threshold - t, u_threshold + t, y);
    v = step(0.5, v);
    vec3 rgb_out = mix(c.rgb, vec3(v), clamp(u_amount, 0.0, 1.0));
    o_color = vec4(rgb_out, c.a);

  } else {
    // colour invert
    c.rgb = mix(c.rgb, vec3(1.0) - c.rgb, clamp(u_amount, 0.0, 1.0));
    o_color = c;
  }
}
