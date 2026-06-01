#version 300 es
precision highp float;

// fluidSim — Flockaroo-style rotational CFD self-advection.
//
// The ownedState buffer stores the fluid: rg = velocity (0.5 = rest),
// b = blue dye channel.  Each frame the velocity field self-advects via
// multi-scale rotational sampling (no divergence-free constraint needed).
// Live video is continuously injected as dye; a geometric field type can
// steer the velocity with a small continuous forcing term.
//
// Reference: Florian Berger (flockaroo), 2016 — shadertoy.com/view/MdlSzM
// Key insight: sampling curl across ROT_NUM evenly-spaced directions and
// averaging gives a stochastic approximation of the local rotation that
// is self-consistent across scales without a pressure-solve step.

in vec2 v_uv;
out vec4 o_color;

uniform sampler2D u_tex;        // live video (injected as dye + initial field seed)
uniform sampler2D u_prev_frame; // previous fluid state: rg=vel (0.5=rest), b=dye

uniform float u_mix;       // wet/dry blend
uniform float u_inject;    // dye injection rate [0,1] → actual rate u_inject * 0.08
uniform float u_viscosity; // decay [0,1] → multiplier [0.994, 1.000]
uniform float u_scale;     // rotation sample base radius [0.5, 4]
uniform float u_speed;     // rotation amplification [0, 2]
uniform float u_fieldType; // 0=none, 1=vortex, 2=linear, 3=curl  (float, rounded)
uniform float u_angle;     // linear field direction normalised [0,1]
uniform float u_cx;        // vortex/curl centre x
uniform float u_cy;        // vortex/curl centre y
uniform float u_seedStr;   // continuous field forcing strength [0,1]

const float TAU = 6.28318530718;
#define ROT_NUM 3

// 120° CCW rotation matrix (column-major: col0=(cos,sin), col1=(-sin,cos))
const mat2 ROT_M = mat2(-0.5, 0.866025, -0.866025, -0.5);

// Per-pixel hash for stochastic starting angle — removes directional bias
// from the equally-spaced rotation samples without needing a noise texture.
float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Flockaroo rotational sampling.
// Samples ROT_NUM velocity vectors equally spaced around a circle of radius sc,
// returns the mean signed curl (cross(v, p) / |p|^2) which is the local
// rotation rate of the velocity field at uv.
float getRot(vec2 uv, float sc) {
    float startAng = hash21(uv) * TAU / float(ROT_NUM);
    vec2 p = vec2(cos(startAng), sin(startAng)) * sc;
    float rot = 0.0;
    for (int i = 0; i < ROT_NUM; i++) {
        vec2 v = texture(u_prev_frame, fract(uv + p)).rg - vec2(0.5);
        rot += (v.x * p.y - v.y * p.x) / max(dot(p, p), 1e-6);
        p = ROT_M * p;
    }
    return rot / float(ROT_NUM);
}

void main() {
    vec3 src = texture(u_tex, v_uv).rgb;

    if (u_mix < 0.0005) {
        o_color = vec4(src, 1.0);
        return;
    }

    int ft = int(u_fieldType + 0.5);

    // --- Multi-scale rotational CFD ---
    float rot = 0.0;
    float sc = u_scale * 0.003;
    for (int i = 0; i < 4; i++) {
        rot += getRot(v_uv, sc);
        sc *= 2.0;
    }
    rot *= u_speed * 0.3;

    // Back-trace by current velocity to find where this pixel's fluid came from
    vec2 vel = texture(u_prev_frame, v_uv).rg - vec2(0.5);
    vec2 advUV = fract(v_uv - vel * u_scale * 0.006);
    vec3 advState = texture(u_prev_frame, advUV).rgb;

    // Rotate the advected velocity by the computed rotation angle
    float cosR = cos(rot);
    float sinR = sin(rot);
    vec2 advVel = advState.rg - vec2(0.5);
    vec2 newVel = vec2(
        cosR * advVel.x - sinR * advVel.y,
        sinR * advVel.x + cosR * advVel.y
    );

    // Viscosity decay toward rest (newVel→0, meaning packed value→0.5)
    float visc = 0.994 + u_viscosity * 0.006;
    newVel *= visc;
    float newB = advState.b * visc;

    // Continuous geometric field forcing (steers velocity without overriding CFD)
    if (ft > 0) {
        vec2 force = vec2(0.0);
        if (ft == 1) {
            // Vortex around (u_cx, u_cy)
            vec2 d = v_uv - vec2(u_cx, u_cy);
            float r = length(d);
            float env = smoothstep(0.0, 0.15, r) * exp(-r * 2.5);
            force = r > 0.001 ? (vec2(-d.y, d.x) / r) * env * 0.35 : vec2(0.0);
        } else if (ft == 2) {
            // Uniform linear flow in u_angle direction
            float a = u_angle * TAU;
            force = vec2(cos(a), sin(a)) * 0.35;
        } else if (ft == 3) {
            // Analytic curl noise (static UV-based, always divergence-free)
            vec2 uv2 = v_uv - vec2(u_cx, u_cy);
            float nx = sin(uv2.x * 6.2 + 0.5) * cos(uv2.y * 5.1);
            float ny = cos(uv2.x * 5.1) * sin(uv2.y * 6.2 - 0.7);
            force = normalize(vec2(-ny, nx) + vec2(0.001)) * 0.35;
        }
        newVel = mix(newVel, force, u_seedStr * 0.025);
    }

    // Clamp velocity to prevent runaway accumulation
    newVel = clamp(newVel, vec2(-0.49), vec2(0.49));

    // Assemble updated fluid state
    vec3 newState = vec3(newVel + vec2(0.5), newB);

    // Inject live video as dye — also couples video colour into the velocity
    // channels (rg), so the video content gradually sculpts the flow pattern
    float injectRate = u_inject * 0.08;
    newState = mix(newState, src, injectRate);

    o_color = vec4(mix(src, newState, u_mix), 1.0);
}
