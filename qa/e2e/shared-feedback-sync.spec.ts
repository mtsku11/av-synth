import { expect, test } from '@playwright/test';

async function setOperatorParam(
  page: import('@playwright/test').Page,
  op: string,
  paramId: string,
  value: number,
  opIndex = 0,
): Promise<boolean> {
  return page.evaluate(
    async ({ nextOp, nextParamId, nextValue, nextOpIndex }) => {
      const bridge = (
        window as Window & {
          __AV_SYNTH_QA__?: {
            setOperatorParam(
              op: string,
              paramId: string,
              value: number,
              opIndex?: number,
            ): Promise<boolean>;
          };
        }
      ).__AV_SYNTH_QA__;
      return (await bridge?.setOperatorParam(nextOp, nextParamId, nextValue, nextOpIndex)) ?? false;
    },
    { nextOp: op, nextParamId: paramId, nextValue: value, nextOpIndex: opIndex },
  );
}

async function getOperatorParam(
  page: import('@playwright/test').Page,
  op: string,
  paramId: string,
  opIndex = 0,
): Promise<number | null> {
  return page.evaluate(
    ({ nextOp, nextParamId, nextOpIndex }) => {
      const bridge = (
        window as Window & {
          __AV_SYNTH_QA__?: {
            getOperatorParam(op: string, paramId: string, opIndex?: number): number | null;
          };
        }
      ).__AV_SYNTH_QA__;
      return bridge?.getOperatorParam(nextOp, nextParamId, nextOpIndex) ?? null;
    },
    { nextOp: op, nextParamId: paramId, nextOpIndex: opIndex },
  );
}

test.describe('shared feedback sync', () => {
  test('editing one feedback node does not collapse distinct feedback nodes onto a single value', async ({
    page,
  }) => {
    await page.goto('/');

    expect(await setOperatorParam(page, 'feedback', 'feedback', 0.24, 0)).toBe(true);
    expect(await setOperatorParam(page, 'feedback', 'feedback', 0.71, 1)).toBe(true);

    expect(await getOperatorParam(page, 'feedback', 'feedback', 0)).toBeCloseTo(0.24, 4);
    expect(await getOperatorParam(page, 'feedback', 'feedback', 1)).toBeCloseTo(0.71, 4);

    expect(await setOperatorParam(page, 'feedback', 'feedback', 0.39, 0)).toBe(true);

    expect(await getOperatorParam(page, 'feedback', 'feedback', 0)).toBeCloseTo(0.39, 4);
    expect(await getOperatorParam(page, 'feedback', 'feedback', 1)).toBeCloseTo(0.71, 4);
  });
});
