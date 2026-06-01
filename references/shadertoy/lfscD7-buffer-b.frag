// Reference-only external shader fragment.
// Source: https://www.shadertoy.com/view/lfscD7
// Buffer: B
// Saved from user-provided snippet on 2026-06-01.

void mainImage( out vec4 rgba, in vec2 xyScreen )
{
    rgba *= 0.;

    // Apply first pass of separable bloom filter
    if(kApplyBloom)
    {
        rgba = vec4(SeparableBlurDown(ivec2(xyScreen), ivec2(iResolution.xy), iChannel0), 1.);
    }
}
