<script lang="ts">
  import { graph } from '../core/graph.svelte';
  import { listOperators } from '../core/coupling';

  const operatorCount = $derived(listOperators().length);
  const nodeCount = $derived(graph.nodes.size);
</script>

<aside class="patch">
  <header>
    <h2>patch</h2>
    <span class="counts">{nodeCount} nodes · {operatorCount} ops registered</span>
  </header>
  <div class="empty">
    <p>operator chains will appear here</p>
    <p class="muted">M1 scaffold — patch UI lands in M4</p>
  </div>
</aside>

<style>
  .patch {
    display: grid;
    grid-template-rows: auto 1fr;
    border-left: 1px solid var(--line);
    background: color-mix(in srgb, var(--bg) 92%, white);
    min-width: 18rem;
  }

  header {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  h2 {
    margin: 0;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    font-family: var(--font-mono);
  }

  .counts {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--muted);
  }

  .empty {
    padding: 1rem;
    display: grid;
    place-content: center;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    color: var(--fg);
  }

  .muted {
    color: var(--muted);
    font-size: 0.7rem;
    margin-top: 0.5rem;
  }
</style>
