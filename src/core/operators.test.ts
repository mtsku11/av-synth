import { describe, expect, it } from 'vitest';

import { getDef, getOperatorUiMeta, listOperatorFamilies, listOps } from './operators';
import { registerAllOps } from '../ops';

registerAllOps();

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
    expect(getOperatorUiMeta('pinchBulge').family).toBe('Feedback');
    expect(getOperatorUiMeta('polarRipple').family).toBe('Feedback');
    expect(getOperatorUiMeta('sinkSourceField').family).toBe('Feedback');
    expect(getOperatorUiMeta('spiralField').family).toBe('Feedback');
    expect(getOperatorUiMeta('domainFold').family).toBe('Feedback');
    expect(getOperatorUiMeta('gyreField').family).toBe('Feedback');
    expect(getOperatorUiMeta('turbulenceWarp').family).toBe('Feedback');
    expect(getOperatorUiMeta('magneticDipole').family).toBe('Feedback');
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

  it('keeps every registered operator uniquely addressable with valid schema and UI metadata', () => {
    const ops = [...listOps()];
    expect(new Set(ops).size).toBe(ops.length);

    for (const op of ops) {
      const def = getDef(op);
      const meta = getOperatorUiMeta(op);
      expect(meta.blurb.length).toBeGreaterThan(0);
      expect(meta.intents.length).toBeGreaterThan(0);

      for (const coreParam of meta.coreParams ?? []) {
        expect(def.paramOrder).toContain(coreParam);
      }

      for (const paramId of def.paramOrder) {
        const defaultValue = def.defaults[paramId];
        const coupling = def.coupling.params[paramId];
        expect(defaultValue).not.toBeUndefined();
        expect(coupling).toBeDefined();
        if (!coupling) {
          throw new Error(`missing coupling for ${op}.${paramId}`);
        }
        const [min, max] = coupling.spec.range;
        expect(defaultValue).toBeGreaterThanOrEqual(min);
        expect(defaultValue).toBeLessThanOrEqual(max);
      }
    }
  });
});
