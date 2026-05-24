import { describe, expect, it } from 'vitest';

import { getOperatorUiMeta, listOperatorFamilies } from './operators';

describe('operator UI metadata', () => {
  it('groups product-surface operators into stable user-facing families', () => {
    expect(listOperatorFamilies()).toEqual([
      'Motion',
      'Color',
      'Texture',
      'Feedback',
      'Blend/Composite',
      'Finish',
      'Audio Character',
    ]);
    expect(getOperatorUiMeta('rotate').family).toBe('Motion');
    expect(getOperatorUiMeta('luma').family).toBe('Finish');
    expect(getOperatorUiMeta('grain').family).toBe('Audio Character');
    expect(getOperatorUiMeta('modulateDisplace').family).toBe('Blend/Composite');
    expect(getOperatorUiMeta('modulateRouted').family).toBe('Blend/Composite');
    expect(getOperatorUiMeta('modulateRotateRouted').family).toBe('Blend/Composite');
    expect(getOperatorUiMeta('modulateScaleRouted').family).toBe('Blend/Composite');
    expect(getOperatorUiMeta('modulatePixelateRouted').family).toBe('Blend/Composite');
    expect(getOperatorUiMeta('modulateRepeatRouted').family).toBe('Blend/Composite');
    expect(getOperatorUiMeta('modulateHueRouted').family).toBe('Blend/Composite');
    expect(getOperatorUiMeta('r').family).toBe('Finish');
    expect(getOperatorUiMeta('sum').family).toBe('Finish');
  });

  it('surfaces curated core controls for node-card summaries', () => {
    expect(getOperatorUiMeta('kaleid').coreParams).toEqual(['nSides', 'drive', 'tone', 'mix']);
    expect(getOperatorUiMeta('selfMod').coreParams).toEqual(['amount', 'ratio', 'feedback', 'mix']);
    expect(getOperatorUiMeta('mask').coreParams).toEqual([
      'amount',
      'threshold',
      'tolerance',
      'invert',
    ]);
  });
});
