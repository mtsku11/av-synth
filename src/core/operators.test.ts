import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getDef, getOperatorUiMeta, isNeutralInstance, listOperatorFamilies, listOps } from './operators';
import { DEFAULT_CHAIN, registerAllOps } from '../ops';

registerAllOps();

const EXPECTED_OPERATOR_IDS = [
  'feedback',
  'timeDisplace',
  'slitScan',
  'structure',
  'flow',
  'dataMosh',
  'pixelSort',
  'fieldSort',
  'vortex',
  'vortexPacket',
  'curlNoise',
  'saddleField',
  'pinchBulge',
  'polarRipple',
  'sinkSourceField',
  'spiralField',
  'domainFold',
  'gyreField',
  'turbulenceWarp',
  'magneticDipole',
  'r',
  'g',
  'b',
  'a',
  'grain',
  'modulate',
  'modulateRouted',
  'modulateDisplace',
  'modulateRotate',
  'modulateRotateRouted',
  'modulateScale',
  'modulateScaleRouted',
  'modulatePixelate',
  'modulatePixelateRouted',
  'modulateRepeat',
  'modulateRepeatRouted',
  'modulateScrollX',
  'modulateScrollY',
  'modulateKaleid',
  'modulateHue',
  'modulateScrollYRouted',
  'modulateHueRouted',
  'selfMod',
  'scale',
  'rotate',
  'scrollX',
  'scrollY',
  'repeat',
  'repeatX',
  'repeatY',
  'pixelate',
  'kaleid',
  'chromaShift',
  'brightness',
  'contrast',
  'color',
  'saturate',
  'posterize',
  'invert',
  'luma',
  'thresh',
  'hue',
  'colorama',
  'sum',
  'add',
  'sub',
  'mult',
  'diff',
  'layer',
  'blend',
  'mask',
  'sourceBlend',
] as const;

describe('operator UI metadata', () => {
  it('keeps every existing operator ID registered and every default-chain op available', () => {
    expect(listOps()).toEqual(EXPECTED_OPERATOR_IDS);
    for (const op of DEFAULT_CHAIN) {
      expect(listOps()).toContain(op);
      expect(() => getDef(op)).not.toThrow();
    }
  });

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

  it('keeps audited alias-family operators wired to real shaders, neutral defaults, and QA cases', () => {
    const auditedOps = listOps()
      .map((op) => ({ op, audit: getDef(op).audit }))
      .filter((entry): entry is { op: string; audit: NonNullable<ReturnType<typeof getDef>['audit']> } => !!entry.audit);
    expect(auditedOps.length).toBeGreaterThan(0);

    for (const { op, audit } of auditedOps) {
      expect(existsSync(resolve(process.cwd(), audit.shaderPath))).toBe(true);
      const expectedCaseOperator = audit.caseOperator ?? op;
      for (const caseId of audit.qaCaseIds) {
        const casePath = resolve(process.cwd(), `qa/cases/${caseId}.json`);
        expect(existsSync(casePath), `missing case file qa/cases/${caseId}.json for op '${op}'`).toBe(true);
        const caseDoc = JSON.parse(readFileSync(casePath, 'utf8')) as {
          audit?: { operator?: string };
        };
        expect(
          caseDoc.audit?.operator,
          `qa/cases/${caseId}.json must declare audit.operator='${expectedCaseOperator}' (op '${op}' references it)`,
        ).toBe(expectedCaseOperator);
      }

      const def = getDef(op);
      const instanceLike = {
        def,
        params: { ...def.defaults },
        lfoAssignments: {},
      } as Parameters<typeof isNeutralInstance>[0];
      expect(isNeutralInstance(instanceLike)).toBe(audit.neutralDefault);
    }
  });
});
