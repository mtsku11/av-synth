// Reference-only external shader fragment.
// Source: https://www.shadertoy.com/view/lfscD7
// Buffer: A
// Saved from user-provided snippet on 2026-06-01.

    SetGlobals(xy, iResolution.xy, iTime);

    if(xy.x > iResolution.x / float(kScreenDownsample) || xy.y > iResolution.y / float(kScreenDownsample)) { return; }

    xy *= float(kScreenDownsample);

    vec3 tint;
    vec2 xyInterfere = xy;
    bool isDisplaced = Interfere(xyInterfere, tint, iResolution.xy);

    ivec2 xyDither = ivec2(xy) / int(HashOf(uint(iTime + sin(iTime) * 1.5), uint(xyInterfere.x / 128.), uint(xyInterfere.y / 128.)) & 127u);
    float jpegDamage = OrderedDither(xyDither);

    #define kAntiAlias 5
    vec3 rgb = vec3(0.0);
    float blend = 0.0;
    for(int i = 0, idx = 0; i < kAntiAlias; ++i)
    {
        for(int j = 0; j < kAntiAlias; ++j, ++idx)
        {
            vec2 xyAA = xyInterfere + vec2(float(i) / float(kAntiAlias), float(j) / float(kAntiAlias));

            rgb += Render(xyAA, idx, sqr(kAntiAlias), isDisplaced, jpegDamage, blend);
        }
    }

    rgb /= float(sqr(kAntiAlias));
    rgb = mix(rgb, Overlay(rgb, vec3(.15, 0.29, 0.39)), blend);

    if(isDisplaced)
    {
        #define kColourQuantisation 5
        //int kColourQuantisation = (isDisplaced) ? 2 : (5 + int(HashOf(uint(iTime + cos(iTime) * 1.5), uint(xyInterfere.x / 128.), uint(xyInterfere.y / 128.)) % 5u));
        rgb *= float(kColourQuantisation);
        if(fract(rgb.x) > jpegDamage) rgb.x += 1.0;
        if(fract(rgb.y) > jpegDamage) rgb.y += 1.0;
        if(fract(rgb.z) > jpegDamage) rgb.z += 1.0;
        rgb = floor(rgb) / float(kColourQuantisation);
    }


    // Scanlines
    //rgb *= mix(1.0, 0.9, float((int(xy.y) / kScreenDownsample) & 1));

    // Grade
    vec3 hsv = RGBToHSV(rgb);
    hsv.x += -sin((hsv.x + 0.05) * kTwoPi) * 0.07;
    hsv.y *= 1.0;
    rgb = HSVToRGB(hsv);

    rgba.xyz = rgb;
    rgba.w = 1.0;
}
