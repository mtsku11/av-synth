// Reference-only external shader fragment.
// Source: https://www.shadertoy.com/view/lfscD7
// Pass: Common
// Saved from user-provided snippet on 2026-06-01.

}

#define BlurKernel Gaussian
//#define BlurKernel Epanechnikov

vec3 SeparableBlurDown(ivec2 xy, ivec2 res, sampler2D sampler)
{
    if(xy.y == 0 || xy.x >= res.x / kBloomDownsample || xy.y >= res.y / kBloomDownsample)
    {
        return kZero;
    }
    else
    {
        int radius = int(0.5 + float(min(res.x, res.y)) * kBloomRadius.x / float(kBloomDownsample));
        vec3 sigmaL = kZero, sigmaWeights = kZero;
        for(int k = -radius; k <= radius; ++k)
        {
            ivec2 ij = (xy + ivec2(k, 0)) * kBloomDownsample;
            vec3 texel = texelFetch(sampler, ij, 0).xyz;
            texel = max(kZero, texel - vec3(kBloomBurnout));
            BlurKernel(k, radius, texel, kBloomKernelShape, sigmaL, sigmaWeights);
        }

        return sigmaL / max(kOne, sigmaWeights);
    }
}

vec3 SeparableBlurUp(ivec2 xyFrag, ivec2 res, sampler2D sampler)
{
    int radius = int(0.5 + float(min(res.x, res.y)) * kBloomRadius.y / float(kBloomDownsample));
    vec3 sigmaL = kZero, sigmaWeights = kZero;
    for(int k = -radius; k <= radius; ++k)
    {
        vec2 uv = (vec2(xyFrag + ivec2(0, k * kBloomDownsample)) - 0.5) / vec2(res);

        vec3 texel = texture(sampler, uv / float(kBloomDownsample), 0.0).xyz;

        BlurKernel(k, radius, texel, kBloomKernelShape, sigmaL, sigmaWeights);
    }

    return sigmaL / max(kOne, sigmaWeights);
}
