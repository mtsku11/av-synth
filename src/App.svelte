<script lang="ts">
  let bootMessage = $state('av-synth — scaffold up');
</script>

<main class="shell">
  <header>
    <h1>av-synth</h1>
    <p class="boot">{bootMessage}</p>
  </header>
  <section class="stage">
    <canvas id="output" width="1280" height="720"></canvas>
  </section>
  <footer>
    <span class="status">M0 scaffold · awaiting M1 architectural skeleton</span>
  </footer>
</main>

<style>
  .shell {
    display: grid;
    grid-template-rows: auto 1fr auto;
    min-height: 100vh;
    color: var(--fg);
    background: var(--bg);
    font-family: var(--font-mono);
  }

  header {
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: baseline;
    gap: 1rem;
  }

  h1 {
    margin: 0;
    font-size: 1rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .boot {
    margin: 0;
    color: var(--muted);
    font-size: 0.85rem;
  }

  .stage {
    display: grid;
    place-items: center;
    padding: 1.5rem;
  }

  canvas {
    width: min(100%, 1280px);
    aspect-ratio: 16 / 9;
    background: #000;
    border: 1px solid var(--line);
  }

  footer {
    padding: 0.5rem 1.5rem;
    border-top: 1px solid var(--line);
    font-size: 0.75rem;
    color: var(--muted);
  }

  .status::before {
    content: '·  ';
    color: var(--accent);
  }
</style>
