#version 300 es
precision highp float;

// curlFlow — vector field simulation applied to live video.
// Based on shadertoy.com/view/3tKSzy companion Buffer A shader.
//
// The ownedState buffer holds the evolving field: RG = velocity (0.5=rest),
// B = divergence proxy. Each frame: read 8-neighbour field, compute curl /
// divergence / Laplacian, update velocity, back-trace the live video UV
// through the field, output warped video. The warped output feeds back as
// the next field state — video colours drive their own curl/vortex patterns.

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;        // TEXTURE0: live video
uniform sampler2D u_prev_frame; // TEXTURE1: field state (ownedState, bindAsPrevFrame)
uniform float u_mix;
uniform float u_strength; // UV warp displacement scale
uniform float u_curl;     // curl rotation response
uniform float u_diffuse;  // Laplacian smoothing strength
uniform float u_inject;   // live-video re-seed rate per frame

const float SQ2 = 0.70710678;
const float AMP = 0.985;    // velocity amplitude decay (prevents runaway)
const float PWR = 0.5;      // curl nonlinearity exponent
const float PS  = 0.07;     // pressure spring (Laplacian of div → expansion)
// Isotropic 9-point Laplacian kernel
const float K0 = -20.0 / 6.0;
const float K1 =   4.0 / 6.0;
const float K2 =   1.0 / 6.0;

void main() {
    vec3 src = texture(u_tex, v_uv).rgb;

    if (u_mix < 0.0005) {
        o_color = vec4(src, 1.0);
        return;
    }

    vec2 tx = 1.0 / vec2(textureSize(u_prev_frame, 0));

    // 8-neighbour reads; field stored as [0,1], centred at 0.5 = rest.
    vec3 vc  = texture(u_prev_frame, v_uv).rgb                      - 0.5;
    vec3 vn  = texture(u_prev_frame, v_uv + vec2( 0.0,  tx.y)).rgb  - 0.5;
    vec3 vs  = texture(u_prev_frame, v_uv + vec2( 0.0, -tx.y)).rgb  - 0.5;
    vec3 ve  = texture(u_prev_frame, v_uv + vec2( tx.x,  0.0)).rgb  - 0.5;
    vec3 vw  = texture(u_prev_frame, v_uv + vec2(-tx.x,  0.0)).rgb  - 0.5;
    vec3 vne = texture(u_prev_frame, v_uv + vec2( tx.x,  tx.y)).rgb - 0.5;
    vec3 vnw = texture(u_prev_frame, v_uv + vec2(-tx.x,  tx.y)).rgb - 0.5;
    vec3 vse = texture(u_prev_frame, v_uv + vec2( tx.x, -tx.y)).rgb - 0.5;
    vec3 vsw = texture(u_prev_frame, v_uv + vec2(-tx.x, -tx.y)).rgb - 0.5;

    // Isotropic Laplacian of all three channels
    vec3 lapl = K0*vc + K1*(vn + ve + vw + vs) + K2*(vne + vnw + vse + vsw);

    // Pressure: Laplacian of divergence channel acts as an expansion spring
    float sp = PS * lapl.z;

    // Discrete curl (z-component of ∇×F) with diagonal corrections
    float curl =
        vn.x - vs.x - ve.y + vw.y +
        SQ2 * (vnw.x + vnw.y + vne.x - vne.y + vsw.y - vsw.x - vse.y - vse.x);

    // Discrete divergence with diagonal corrections
    float div =
        vs.y - vn.y - ve.x + vw.x +
        SQ2 * (vnw.x - vnw.y - vne.x - vne.y + vsw.x + vsw.y + vse.y - vse.x);

    // Curl-driven rotation angle (nonlinear response via power)
    float sc = u_curl * sign(curl) * pow(abs(curl), PWR);

    // Velocity update: decay + diffusion + pressure steering
    vec2 norm = length(vc.xy) > 0.001 ? normalize(vc.xy) : vec2(0.0);
    float ta = AMP * vc.x + u_diffuse * lapl.x + norm.x * sp;
    float tb = AMP * vc.y + u_diffuse * lapl.y + norm.y * sp;

    // Rotate velocity by curl angle
    float cosC = cos(sc), sinC = sin(sc);
    vec2 newVel = clamp(
        vec2(ta * cosC - tb * sinC, ta * sinC + tb * cosC),
        vec2(-0.49), vec2(0.49)
    );
    float newDiv = clamp(div, -0.49, 0.49);

    // Re-seed field from live video (video colours continuously inject energy)
    float inj = u_inject * 0.04;
    newVel = mix(newVel, src.rg - 0.5, inj);
    newDiv = mix(newDiv, src.b  - 0.5, inj);

    // Semi-Lagrangian back-trace: look up live video where each pixel came from
    vec2 warpUV = fract(v_uv - newVel * u_strength);
    vec3 warped = texture(u_tex, warpUV).rgb;

    // Output warped video; this also becomes ownedState.next (the next field).
    // Next frame's curl/div is computed from this warped frame's colour gradients.
    o_color = vec4(mix(src, warped, u_mix), 1.0);
}
