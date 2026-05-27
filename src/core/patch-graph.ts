import type { OperatorInstance } from './operators';
import { isNeutralInstance } from './operators';
import type { ParamSpec } from './params';
import type { ParamLfoAssignmentView } from './mod-bank';
import { buildParamLfoAssignmentView } from './mod-bank';
import {
  BUS_INDICES,
  SOURCE_NODE_ID,
  busReturnId,
  parseBusReturnId,
  type BusIndex,
  type PatchNode,
} from './graph.svelte';

export interface GraphDiagnostic {
  code:
    | 'monitor-bus-empty'
    | 'bus-multi-sink'
    | 'convergence-approximation'
    | 'dangling-input'
    | 'bus-return-empty';
  message: string;
  nodeId?: string;
}

export interface GraphExecutionStep {
  id: string;
  op: string;
  bus: BusIndex;
  inputIds: string[];
  instance: OperatorInstance;
}

export interface PatchInputOption {
  id: string;
  label: string;
}

export interface PatchInputView {
  id: string;
  label: string;
  removable: boolean;
}

export interface PatchParamView {
  id: string;
  label: string;
  spec: ParamSpec;
  value: number;
  defaultValue: number;
  lfo: ParamLfoAssignmentView;
}

export interface PatchNodeView {
  id: string;
  op: string;
  order: number;
  bus: BusIndex;
  inputArity: 1 | 2;
  active: boolean;
  monitor: boolean;
  reachable: boolean;
  status: 'live' | 'bypass' | 'staged' | 'approx';
  summary: string[];
  params: PatchParamView[];
  inputs: PatchInputView[];
  primaryInputId: string;
  secondaryInputId: string;
  primaryInputOptions: PatchInputOption[];
  secondaryInputOptions: PatchInputOption[];
  warnings: string[];
}

export interface GraphExecutionPlan {
  monitorBus: BusIndex;
  monitorNodeId: string | null;
  busOutputIds: Partial<Record<BusIndex, string>>;
  steps: GraphExecutionStep[];
  executableInstances: OperatorInstance[];
  executableIds: Set<string>;
  diagnostics: GraphDiagnostic[];
}

function buildBusReturnOptions(): PatchInputOption[] {
  return BUS_INDICES.map((bus) => ({ id: busReturnId(bus), label: `src(o${bus})` }));
}

function labelInput(inputId: string, nodeById: ReadonlyMap<string, PatchNode>): string {
  if (inputId === SOURCE_NODE_ID) return 'source';
  const bus = parseBusReturnId(inputId);
  if (bus !== null) return `src(o${bus})`;
  const node = nodeById.get(inputId);
  return node ? `${node.op} · o${node.bus}` : inputId;
}

function formatValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  if (abs >= 1) return value.toFixed(2);
  if (abs >= 0.1) return value.toFixed(3);
  return value.toFixed(4);
}

function buildSummary(instance: OperatorInstance): string[] {
  return instance.def.paramOrder
    .filter((paramId) => {
      const current = instance.params[paramId] ?? instance.def.defaults[paramId] ?? 0;
      const fallback = instance.def.defaults[paramId] ?? 0;
      return Math.abs(current - fallback) > 1e-6;
    })
    .map((paramId) => {
      const label = instance.def.coupling.params[paramId]?.spec.label ?? paramId;
      const value = instance.params[paramId] ?? instance.def.defaults[paramId] ?? 0;
      return `${label} ${formatValue(value)}`;
    });
}

function buildParamViews(instance: OperatorInstance): PatchParamView[] {
  const hidden = instance.def.hiddenParams?.(instance.params) ?? null;
  return instance.def.paramOrder
    .filter((paramId) => !hidden?.has(paramId))
    .map((paramId) => {
      const spec = instance.def.coupling.params[paramId]?.spec;
      const fallback = instance.def.defaults[paramId] ?? 0;
      return {
        id: paramId,
        label: spec?.label ?? paramId,
        spec: spec ?? {
          id: paramId,
          label: paramId,
          range: [0, 1],
          default: fallback,
          curve: 'lin',
          unit: 'norm',
        },
        value: instance.params[paramId] ?? fallback,
        defaultValue: fallback,
        lfo: buildParamLfoAssignmentView(instance.lfoAssignments, paramId),
      };
    });
}

export function orderInstancesByGraph(
  instances: readonly OperatorInstance[],
  nodes: readonly PatchNode[],
): OperatorInstance[] {
  const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
  const ordered: OperatorInstance[] = [];
  for (const node of nodes) {
    const instance = instanceById.get(node.id);
    if (instance) ordered.push(instance);
  }
  for (const instance of instances) {
    if (!instanceById.has(instance.id)) continue;
    if (!ordered.includes(instance)) ordered.push(instance);
  }
  return ordered;
}

export function compileGraphExecution(
  nodes: readonly PatchNode[],
  instances: readonly OperatorInstance[],
  monitorBus: BusIndex = 0,
): GraphExecutionPlan {
  const diagnostics: GraphDiagnostic[] = [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
  const reachable = new Set<string>();
  const steps: GraphExecutionStep[] = [];
  const busOutputIds: Partial<Record<BusIndex, string>> = {};
  let monitorNodeId: string | null = null;

  for (const bus of BUS_INDICES) {
    const sinks = nodes.filter((node) => node.bus === bus);
    const sink = sinks.at(-1) ?? null;
    if (sink) busOutputIds[bus] = sink.id;
    if (bus === monitorBus) monitorNodeId = sink?.id ?? null;
    if (sinks.length > 1 && sink) {
      diagnostics.push({
        code: 'bus-multi-sink',
        nodeId: sink.id,
        message: `bus o${bus} has ${sinks.length} sink candidates; runtime follows the last node in graph order`,
      });
    }
  }

  if (!monitorNodeId) {
    diagnostics.push({
      code: 'monitor-bus-empty',
      message: `monitor bus o${monitorBus} has no output node; source preview stays live until a node lands on that bus`,
    });
  }

  const seen = new Set<string>();
  const resolveInputIds = (node: PatchNode): string[] => {
    const instance = instanceById.get(node.id);
    const inputArity = instance?.def.inputArity ?? 1;
    const resolved = node.inputs.length > 0 ? [...node.inputs] : [SOURCE_NODE_ID];
    while (resolved.length < inputArity) resolved.push(SOURCE_NODE_ID);
    return resolved.slice(0, inputArity);
  };
  const walk = (nodeId: string): void => {
    if (seen.has(nodeId)) return;
    seen.add(nodeId);
    const node = nodeById.get(nodeId);
    if (!node) return;
    const instance = instanceById.get(node.id);
    const inputArity = instance?.def.inputArity ?? 1;
    if (node.inputs.length > inputArity) {
      diagnostics.push({
        code: 'convergence-approximation',
        nodeId,
        message:
          inputArity === 1
            ? `${node.op} accepts 1 input; route convergence through a Blend node before ${node.op}`
            : `${node.op} accepts 2 inputs; runtime uses the first two wires and ignores the rest`,
      });
    }
    const inputIds = resolveInputIds(node);
    for (const inputId of inputIds) {
      if (!inputId || inputId === SOURCE_NODE_ID) continue;
      const bus = parseBusReturnId(inputId);
      if (bus !== null) {
        if (!busOutputIds[bus]) {
          diagnostics.push({
            code: 'bus-return-empty',
            nodeId,
            message: `${node.op} reads src(o${bus}), but bus o${bus} has no routed output yet`,
          });
        }
        continue;
      }
      if (!nodeById.has(inputId)) {
        diagnostics.push({
          code: 'dangling-input',
          nodeId,
          message: `${node.op} references missing input '${inputId}'`,
        });
        continue;
      }
      walk(inputId);
    }
    reachable.add(nodeId);
    if (!instance) return;
    steps.push({
      id: node.id,
      op: node.op,
      bus: node.bus,
      inputIds,
      instance,
    });
  };

  for (const nodeId of Object.values(busOutputIds)) {
    if (!nodeId) continue;
    walk(nodeId);
  }

  const executableInstances = steps.map((step) => step.instance);

  return {
    monitorBus,
    monitorNodeId,
    busOutputIds,
    steps,
    executableInstances,
    executableIds: reachable,
    diagnostics,
  };
}

export function buildPatchNodeViews(
  nodes: readonly PatchNode[],
  instances: readonly OperatorInstance[],
  plan: GraphExecutionPlan,
): PatchNodeView[] {
  const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const busReturnOptions = buildBusReturnOptions();
  const warningMap = new Map<string, string[]>();
  const approxIds = new Set<string>();
  for (const diagnostic of plan.diagnostics) {
    if (!diagnostic.nodeId) continue;
    const list = warningMap.get(diagnostic.nodeId) ?? [];
    list.push(diagnostic.message);
    warningMap.set(diagnostic.nodeId, list);
    if (diagnostic.code === 'convergence-approximation') approxIds.add(diagnostic.nodeId);
  }

  return nodes.map((node, index) => {
    const instance = instanceById.get(node.id);
    const inputArity = (instance?.def.inputArity ?? 1) as 1 | 2;
    const active = instance ? !isNeutralInstance(instance) : false;
    const reachable = plan.executableIds.has(node.id);
    const warnings = warningMap.get(node.id) ?? [];
    const approx = approxIds.has(node.id);
    const status = reachable ? (approx ? 'approx' : active ? 'live' : 'bypass') : 'staged';
    const previousNodes = nodes.slice(0, index);
    const selectableNodes = previousNodes.filter((candidate) => candidate.id !== node.id);
    const currentPrimary = node.inputs[0] ? nodeById.get(node.inputs[0]) : null;
    const primaryInputOptions: PatchInputOption[] = [
      { id: SOURCE_NODE_ID, label: 'source' },
      ...busReturnOptions,
    ];
    if (
      currentPrimary &&
      !selectableNodes.some((candidate) => candidate.id === currentPrimary.id)
    ) {
      primaryInputOptions.push({
        id: currentPrimary.id,
        label: `${currentPrimary.op} · o${currentPrimary.bus}`,
      });
    }
    primaryInputOptions.push(
      ...selectableNodes.map((candidate) => ({
        id: candidate.id,
        label: `${candidate.op} · o${candidate.bus}`,
      })),
    );
    const currentSecondary = node.inputs[1] ?? SOURCE_NODE_ID;
    const secondaryInputOptions: PatchInputOption[] = [
      { id: SOURCE_NODE_ID, label: 'source' },
      ...busReturnOptions.filter((option) => option.id !== node.inputs[0]),
    ];
    if (
      currentSecondary !== SOURCE_NODE_ID &&
      !secondaryInputOptions.some((option) => option.id === currentSecondary)
    ) {
      secondaryInputOptions.push({
        id: currentSecondary,
        label: labelInput(currentSecondary, nodeById),
      });
    }
    secondaryInputOptions.push(
      ...selectableNodes
        .filter((candidate) => candidate.id !== node.inputs[0] && candidate.id !== currentSecondary)
        .map((candidate) => ({
          id: candidate.id,
          label: `${candidate.op} · o${candidate.bus}`,
        })),
    );
    const inputs: PatchInputView[] =
      node.inputs.length === 0
        ? [{ id: SOURCE_NODE_ID, label: 'source', removable: false }]
        : node.inputs.map((inputId, inputIndex) => {
            return {
              id: inputId,
              label: labelInput(inputId, nodeById),
              removable: inputIndex > 0,
            };
          });

    return {
      id: node.id,
      op: node.op,
      order: node.order,
      bus: node.bus,
      inputArity,
      active,
      monitor: plan.monitorNodeId === node.id,
      reachable,
      status,
      summary: instance ? buildSummary(instance) : [],
      params: instance ? buildParamViews(instance) : [],
      inputs,
      primaryInputId: node.inputs[0] ?? SOURCE_NODE_ID,
      secondaryInputId: currentSecondary,
      primaryInputOptions,
      secondaryInputOptions,
      warnings,
    };
  });
}
