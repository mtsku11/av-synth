// Patch graph data model. Reactive via Svelte 5 runes + SvelteMap.
// Topology lives here; runtime compilation into the currently-supported
// executable chain happens in `patch-graph.ts`.

import { SvelteMap } from 'svelte/reactivity';
import type { OperatorInstance } from './operators';

export type BusIndex = 0 | 1 | 2 | 3;
export const BUS_INDICES: readonly BusIndex[] = [0, 1, 2, 3];
export const SOURCE_NODE_ID = 'source';
export const BUS_RETURN_PREFIX = 'bus:';

export function busReturnId(bus: BusIndex): string {
  return `${BUS_RETURN_PREFIX}${bus}`;
}

export function parseBusReturnId(inputId: string | null | undefined): BusIndex | null {
  if (!inputId || !inputId.startsWith(BUS_RETURN_PREFIX)) return null;
  const raw = Number(inputId.slice(BUS_RETURN_PREFIX.length));
  return raw === 0 || raw === 1 || raw === 2 || raw === 3 ? raw : null;
}

export interface PatchNode {
  id: string;
  op: string;
  params: Record<string, number>;
  inputs: string[]; // upstream node ids
  bus: BusIndex; // which output bus (o0..o3) this node lives on
  order: number; // topological/editor order; upstream inputs must come earlier
}

function normaliseInputs(inputs: readonly string[]): string[] {
  const next: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (!next.includes(input)) next.push(input);
  }
  return next;
}

function shallowEqualParams(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] ?? 0) !== (right[key] ?? 0)) return false;
  }
  return true;
}

export class Graph {
  readonly nodes = new SvelteMap<string, PatchNode>();

  add(node: PatchNode): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node '${node.id}' already exists`);
    }
    this.nodes.set(node.id, {
      ...node,
      inputs: normaliseInputs(node.inputs),
    });
  }

  remove(id: string): void {
    this.nodes.delete(id);
    // Strip dangling references from any remaining nodes.
    for (const n of this.nodes.values()) {
      const filtered = n.inputs.filter((i) => i !== id);
      if (filtered.length !== n.inputs.length) {
        this.nodes.set(n.id, { ...n, inputs: filtered });
      }
    }
  }

  clear(): void {
    this.nodes.clear();
  }

  get(id: string): PatchNode | undefined {
    return this.nodes.get(id);
  }

  list(): PatchNode[] {
    return [...this.nodes.values()].sort((left, right) => left.order - right.order);
  }

  replaceFromInstances(instances: readonly OperatorInstance[]): void {
    this.clear();
    instances.forEach((instance, index) => {
      this.add({
        id: instance.id,
        op: instance.def.op,
        params: { ...instance.params },
        inputs: index > 0 ? [instances[index - 1]!.id] : [],
        bus: 0,
        order: index,
      });
    });
  }

  syncParams(instances: readonly OperatorInstance[]): void {
    for (const instance of instances) {
      const node = this.nodes.get(instance.id);
      if (!node) continue;
      if (shallowEqualParams(node.params, instance.params)) continue;
      this.nodes.set(instance.id, { ...node, params: { ...instance.params } });
    }
  }

  setInputs(id: string, inputs: readonly string[]): void {
    const node = this.nodes.get(id);
    if (!node) return;
    const nextInputs = normaliseInputs(inputs);
    if (
      nextInputs.length === node.inputs.length &&
      nextInputs.every((input, index) => input === node.inputs[index])
    ) {
      return;
    }
    this.nodes.set(id, { ...node, inputs: nextInputs });
  }

  setBus(id: string, bus: BusIndex): void {
    const node = this.nodes.get(id);
    if (!node || node.bus === bus) return;
    this.nodes.set(id, { ...node, bus });
  }

  setPrimaryInput(id: string, inputId: string | null): void {
    const node = this.nodes.get(id);
    if (!node) return;
    const extras = node.inputs.slice(1).filter((input) => input !== inputId);
    if (!inputId || inputId === SOURCE_NODE_ID) {
      const preserved = node.inputs[0];
      if (preserved && preserved !== SOURCE_NODE_ID && !extras.includes(preserved)) {
        extras.unshift(preserved);
      }
    }
    const nextInputs =
      inputId && inputId !== SOURCE_NODE_ID
        ? [inputId, ...extras]
        : extras.length > 0
          ? [SOURCE_NODE_ID, ...extras]
          : [];
    this.nodes.set(id, { ...node, inputs: normaliseInputs(nextInputs) });
  }

  addInput(id: string, inputId: string): void {
    if (!inputId || inputId === SOURCE_NODE_ID) return;
    const node = this.nodes.get(id);
    if (!node || node.inputs.includes(inputId)) return;
    this.nodes.set(id, { ...node, inputs: [...node.inputs, inputId] });
  }

  removeInput(id: string, inputId: string): void {
    const node = this.nodes.get(id);
    if (!node) return;
    const nextInputs = node.inputs.filter((input) => input !== inputId);
    if (nextInputs.length === node.inputs.length) return;
    this.nodes.set(id, { ...node, inputs: nextInputs });
  }

  move(id: string, direction: -1 | 1): void {
    const ordered = this.list();
    const from = ordered.findIndex((node) => node.id === id);
    if (from < 0) return;
    const to = from + direction;
    if (to < 0 || to >= ordered.length) return;
    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    next.forEach((node, index) => {
      if (node.order === index) return;
      this.nodes.set(node.id, { ...node, order: index });
    });
  }

  // Nodes routed to a specific output bus, in insertion order.
  forBus(bus: BusIndex): PatchNode[] {
    return this.list().filter((n) => n.bus === bus);
  }
}

export const graph = new Graph();
