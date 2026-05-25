import { describe, expect, it } from 'vitest';
import type { OperatorInstance, OperatorDef } from './operators';
import type { OperatorCoupling } from './coupling';
import { createParamLfoAssignment } from './mod-bank';
import { buildPatchNodeViews, compileGraphExecution, orderInstancesByGraph } from './patch-chain';
import { SOURCE_NODE_ID, busReturnId, type PatchNode } from './graph.svelte';

function makeInstance(
  id: string,
  op: string,
  defaults: Record<string, number>,
  params: Record<string, number>,
  inputArity: 1 | 2 = 1,
): OperatorInstance {
  const coupling: OperatorCoupling = {
    op,
    params: Object.fromEntries(
      Object.keys(defaults).map((paramId) => [
        paramId,
        {
          spec: {
            id: paramId,
            label: paramId,
            range: [0, 1],
            default: defaults[paramId] ?? 0,
            curve: 'lin',
            unit: 'norm',
          },
          toVideo: (raw) => raw,
        },
      ]),
    ),
  };

  const def: OperatorDef = {
    op,
    coupling,
    inputArity,
    paramOrder: Object.keys(defaults),
    defaults,
    createVideoStage: () => ({
      op,
      program: null as never,
      setUniforms: () => {},
      dispose: () => {},
    }),
  };

  return {
    id,
    def,
    videoStage: null as never,
    params,
    lfoAssignments: Object.fromEntries(
      Object.keys(defaults).map((paramId) => [paramId, createParamLfoAssignment()]),
    ),
  };
}

describe('patch chain helpers', () => {
  it('orders instances by graph node order', () => {
    const first = makeInstance('node-a', 'feedback', { feedback: 0 }, { feedback: 0.2 });
    const second = makeInstance('node-b', 'contrast', { amount: 1 }, { amount: 1 });
    const third = makeInstance('node-c', 'hue', { amount: 0 }, { amount: 0.4 });
    const nodes: PatchNode[] = [
      {
        id: third.id,
        op: third.def.op,
        params: third.params,
        inputs: ['node-b'],
        bus: 0,
        order: 0,
      },
      { id: first.id, op: first.def.op, params: first.params, inputs: [], bus: 0, order: 1 },
      {
        id: second.id,
        op: second.def.op,
        params: second.params,
        inputs: ['node-a'],
        bus: 1,
        order: 2,
      },
    ];

    const ordered = orderInstancesByGraph([first, second, third], nodes);
    expect(ordered.map((instance) => instance.id)).toEqual(['node-c', 'node-a', 'node-b']);
  });

  it('builds node views with active state, summaries, and staged branches', () => {
    const feedback = makeInstance(
      'node-a',
      'feedback',
      { feedback: 0, delayTime: 0.18 },
      { feedback: 0, delayTime: 0.18 },
    );
    const contrast = makeInstance('node-b', 'contrast', { amount: 1 }, { amount: 1.25 });
    const hue = makeInstance('node-c', 'hue', { amount: 0 }, { amount: 0.4 });
    const nodes: PatchNode[] = [
      {
        id: feedback.id,
        op: feedback.def.op,
        params: feedback.params,
        inputs: [],
        bus: 0,
        order: 0,
      },
      {
        id: contrast.id,
        op: contrast.def.op,
        params: contrast.params,
        inputs: [feedback.id],
        bus: 1,
        order: 1,
      },
      { id: hue.id, op: hue.def.op, params: hue.params, inputs: [feedback.id], bus: 0, order: 2 },
    ];

    const ordered = orderInstancesByGraph([feedback, contrast, hue], nodes);
    const plan = compileGraphExecution(nodes, ordered, 0);
    const views = buildPatchNodeViews(nodes, ordered, plan);

    expect(views).toHaveLength(3);
    expect(views[0]).toMatchObject({
      op: 'feedback',
      active: false,
      status: 'bypass',
      summary: [],
    });
    expect(views[1]?.status).toBe('live');
    expect(views[2]).toMatchObject({
      op: 'hue',
      active: true,
      monitor: true,
      status: 'live',
      summary: ['amount 0.400'],
    });
  });

  it('flags convergence and follows the primary wire for runtime execution', () => {
    const feedback = makeInstance('node-a', 'feedback', { feedback: 0 }, { feedback: 0.2 });
    const contrast = makeInstance('node-b', 'contrast', { amount: 1 }, { amount: 1.1 });
    const hue = makeInstance('node-c', 'hue', { amount: 0 }, { amount: 0.4 });
    const nodes: PatchNode[] = [
      {
        id: feedback.id,
        op: feedback.def.op,
        params: feedback.params,
        inputs: [],
        bus: 0,
        order: 0,
      },
      {
        id: contrast.id,
        op: contrast.def.op,
        params: contrast.params,
        inputs: [],
        bus: 1,
        order: 1,
      },
      {
        id: hue.id,
        op: hue.def.op,
        params: hue.params,
        inputs: [feedback.id, contrast.id],
        bus: 0,
        order: 2,
      },
    ];

    const ordered = orderInstancesByGraph([feedback, contrast, hue], nodes);
    const plan = compileGraphExecution(nodes, ordered, 0);

    expect(plan.executableInstances.map((instance) => instance.id)).toEqual([
      'node-a',
      'node-c',
      'node-b',
    ]);
    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'convergence-approximation',
    );
  });

  it('executes real two-input blend convergence without the primary-wire warning', () => {
    const feedback = makeInstance('node-a', 'feedback', { feedback: 0 }, { feedback: 0.2 });
    const contrast = makeInstance('node-b', 'contrast', { amount: 1 }, { amount: 1.1 });
    const blend = makeInstance('node-c', 'blend', { amount: 0 }, { amount: 0.5 }, 2);
    const nodes: PatchNode[] = [
      {
        id: feedback.id,
        op: feedback.def.op,
        params: feedback.params,
        inputs: [],
        bus: 0,
        order: 0,
      },
      {
        id: contrast.id,
        op: contrast.def.op,
        params: contrast.params,
        inputs: [],
        bus: 1,
        order: 1,
      },
      {
        id: blend.id,
        op: blend.def.op,
        params: blend.params,
        inputs: [feedback.id, contrast.id],
        bus: 0,
        order: 2,
      },
    ];

    const ordered = orderInstancesByGraph([feedback, contrast, blend], nodes);
    const plan = compileGraphExecution(nodes, ordered, 0);
    const [feedbackView, contrastView, blendView] = buildPatchNodeViews(nodes, ordered, plan);

    expect(plan.steps.map((step) => ({ id: step.id, inputIds: step.inputIds }))).toEqual([
      { id: 'node-a', inputIds: [SOURCE_NODE_ID] },
      { id: 'node-b', inputIds: [SOURCE_NODE_ID] },
      { id: 'node-c', inputIds: ['node-a', 'node-b'] },
    ]);
    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      'convergence-approximation',
    );
    expect(feedbackView?.inputArity).toBe(1);
    expect(contrastView?.inputArity).toBe(1);
    expect(blendView?.inputArity).toBe(2);
    expect(blendView?.secondaryInputId).toBe('node-b');
    expect(blendView?.secondaryInputOptions.map((option) => option.id)).toContain('node-b');
  });

  it('compiles every live bus sink while keeping a selectable monitor bus', () => {
    const feedback = makeInstance('node-a', 'feedback', { feedback: 0 }, { feedback: 0.2 });
    const hue = makeInstance('node-b', 'hue', { amount: 0 }, { amount: 0.4 });
    const contrast = makeInstance('node-c', 'contrast', { amount: 1 }, { amount: 1.2 });
    const nodes: PatchNode[] = [
      {
        id: feedback.id,
        op: feedback.def.op,
        params: feedback.params,
        inputs: [],
        bus: 0,
        order: 0,
      },
      {
        id: hue.id,
        op: hue.def.op,
        params: hue.params,
        inputs: [feedback.id],
        bus: 0,
        order: 1,
      },
      {
        id: contrast.id,
        op: contrast.def.op,
        params: contrast.params,
        inputs: [feedback.id],
        bus: 1,
        order: 2,
      },
    ];

    const ordered = orderInstancesByGraph([feedback, hue, contrast], nodes);
    const plan = compileGraphExecution(nodes, ordered, 1);

    expect(plan.monitorNodeId).toBe('node-c');
    expect(plan.busOutputIds).toEqual({ 0: 'node-b', 1: 'node-c' });
    expect(plan.executableInstances.map((instance) => instance.id)).toEqual([
      'node-a',
      'node-b',
      'node-c',
    ]);
  });

  it('treats src(oN) as a legal graph input for self-mod and bus-return routing', () => {
    const modulate = makeInstance('node-a', 'modulate', { amount: 0 }, { amount: 0.3 });
    const nodes: PatchNode[] = [
      {
        id: modulate.id,
        op: modulate.def.op,
        params: modulate.params,
        inputs: [busReturnId(0)],
        bus: 0,
        order: 0,
      },
    ];

    const ordered = orderInstancesByGraph([modulate], nodes);
    const plan = compileGraphExecution(nodes, ordered, 0);

    expect(plan.steps.map((step) => ({ id: step.id, inputIds: step.inputIds }))).toEqual([
      { id: 'node-a', inputIds: [busReturnId(0)] },
    ]);
    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('dangling-input');
    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('bus-return-empty');
  });

  it('warns when src(oN) references a bus with no routed sink yet', () => {
    const hue = makeInstance('node-a', 'hue', { amount: 0 }, { amount: 0.2 });
    const nodes: PatchNode[] = [
      {
        id: hue.id,
        op: hue.def.op,
        params: hue.params,
        inputs: [busReturnId(2)],
        bus: 0,
        order: 0,
      },
    ];

    const ordered = orderInstancesByGraph([hue], nodes);
    const plan = compileGraphExecution(nodes, ordered, 0);

    expect(plan.steps[0]?.inputIds).toEqual([busReturnId(2)]);
    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain('bus-return-empty');
  });
});
