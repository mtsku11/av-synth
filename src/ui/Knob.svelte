<script lang="ts">
  import type { ParamSpec } from '../core/params';
  import { formatValue } from '../core/params';
  import { mapToCurve, mapFromCurve, clamp01, TAU } from '../lib/math';

  interface Props {
    spec: ParamSpec;
    value: number;
    size?: number;
  }

  let { spec, value = $bindable(), size = 48 }: Props = $props();

  const c01 = $derived(mapFromCurve(value, spec.range, spec.curve));

  // Arc from -135° to +135° (270° sweep), zero at the bottom.
  const ANGLE_MIN = (-135 * Math.PI) / 180;
  const ANGLE_MAX = (135 * Math.PI) / 180;
  const angle = $derived(ANGLE_MIN + (ANGLE_MAX - ANGLE_MIN) * c01);

  const indicatorX = $derived(Math.sin(angle));
  const indicatorY = $derived(-Math.cos(angle));

  let dragging = $state(false);
  let lastY = 0;

  function onPointerDown(e: PointerEvent) {
    dragging = true;
    lastY = e.clientY;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function onPointerUp(e: PointerEvent) {
    dragging = false;
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dy = lastY - e.clientY;
    lastY = e.clientY;
    // Coarse sensitivity by default; shift for fine-tune.
    const sensitivity = e.shiftKey ? 0.0005 : 0.005;
    const next = clamp01(c01 + dy * sensitivity);
    value = mapToCurve(next, spec.range, spec.curve);
  }

  // Arc path: full sweep background + filled arc up to current value.
  const r = $derived(size * 0.4);
  const cx = $derived(size / 2);
  const cy = $derived(size / 2);
  const arcPath = $derived(arcSvg(cx, cy, r, ANGLE_MIN, angle));

  function arcSvg(x: number, y: number, radius: number, a0: number, a1: number): string {
    const sweep = a1 - a0;
    const large = Math.abs(sweep) > Math.PI ? 1 : 0;
    const dir = sweep >= 0 ? 1 : 0;
    const x0 = x + radius * Math.sin(a0);
    const y0 = y - radius * Math.cos(a0);
    const x1 = x + radius * Math.sin(a1);
    const y1 = y - radius * Math.cos(a1);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius} ${radius} 0 ${large} ${dir} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }

  const bgArc = $derived(arcSvg(cx, cy, r, ANGLE_MIN, ANGLE_MAX));
  // sweep used implicitly via ANGLE_MAX - ANGLE_MIN
  void TAU; // touch import so tree-shaking doesn't drop it for future code
</script>

<div class="knob" style="--size: {size}px">
  <svg
    width={size}
    height={size}
    viewBox="0 0 {size} {size}"
    role="slider"
    aria-label={spec.label}
    aria-valuemin={spec.range[0]}
    aria-valuemax={spec.range[1]}
    aria-valuenow={value}
    tabindex="0"
    onpointerdown={onPointerDown}
    onpointerup={onPointerUp}
    onpointermove={onPointerMove}
  >
    <circle cx={cx} cy={cy} r={r + 4} fill="var(--bg)" stroke="var(--line)" stroke-width="1" />
    <path d={bgArc} stroke="var(--line)" stroke-width="2" fill="none" stroke-linecap="round" />
    <path d={arcPath} stroke="var(--accent)" stroke-width="2" fill="none" stroke-linecap="round" />
    <line
      x1={cx}
      y1={cy}
      x2={cx + indicatorX * r * 0.9}
      y2={cy + indicatorY * r * 0.9}
      stroke="var(--accent)"
      stroke-width="1.5"
      stroke-linecap="round"
    />
  </svg>
  <div class="label">{spec.label}</div>
  <div class="value">{formatValue(spec, value)}</div>
</div>

<style>
  .knob {
    display: grid;
    justify-items: center;
    gap: 0.15rem;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    user-select: none;
  }
  .label {
    color: var(--fg);
    letter-spacing: 0.04em;
    text-transform: lowercase;
  }
  .value {
    color: var(--accent);
    font-variant-numeric: tabular-nums;
  }
  svg {
    cursor: ns-resize;
    touch-action: none;
  }
  svg:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 2px;
    border-radius: 50%;
  }
</style>
