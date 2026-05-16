// Patch graph data model. Reactive via Svelte 5 runes + SvelteMap.
// M1 skeleton — node create/remove/lookup. Edge handling and serialisation
// land in M2 / M4 respectively.

import { SvelteMap } from 'svelte/reactivity';

export type BusIndex = 0 | 1 | 2 | 3;

export interface PatchNode {
  id: string;
  op: string;
  params: Record<string, number>;
  inputs: string[]; // upstream node ids
  bus: BusIndex; // which output bus (o0..o3) this node lives on
}

class Graph {
  readonly nodes = new SvelteMap<string, PatchNode>();

  add(node: PatchNode): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node '${node.id}' already exists`);
    }
    this.nodes.set(node.id, node);
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

  // Nodes routed to a specific output bus, in insertion order.
  forBus(bus: BusIndex): PatchNode[] {
    return [...this.nodes.values()].filter((n) => n.bus === bus);
  }
}

export const graph = new Graph();

// Counter-based id generator. Good enough until we need persistence.
let _id = 0;
export const nextNodeId = (op: string): string => `${op}-${++_id}`;
