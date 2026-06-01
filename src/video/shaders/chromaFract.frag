#version 300 es
precision highp float;

// chromaFract — compression-artifact visualiser.
// Variant of shadertoy.com/view/3tKSzy
//
// sqrt lifts the input to perceptual space; subtracting the channel mean
// isolates the chroma deviation (how far each channel diverges from grey);
// fract(scale * chroma) creates quantisation banding at the chosen density;
// squaring restores a gentle gamma curve.

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;
uniform float u_mix;
uniform float u_scale; // amplification before fract — controls band density

void main() {
    vec3 src = texture(u_tex, v_uv).rgb;

    if (u_mix < 0.0005) {
        o_color = vec4(src, 1.0);
        return;
    }

    vec3 c = sqrt(src);
    float luma = (c.r + c.g + c.b) / 3.0;
    vec3 result = fract(u_scale * (c - luma));
    result *= result;

    o_color = vec4(mix(src, result, u_mix), 1.0);
}
