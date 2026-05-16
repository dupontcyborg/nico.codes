import {
  add,
  configureWasm,
  linspace,
  multiply,
  type NDArrayCore,
  sin,
  wasmFreeBytes,
} from "numpy-ts/core";

try {
  configureWasm({ maxMemory: 32 * 1024 * 1024 });
} catch {}

const DEBUG_WASM = import.meta.env.DEV;

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}

// Persists across destroy/init cycles so the wave continues seamlessly
let _t = 0;
// Track whether masthead was on the previous page — reset reveal when coming from a page without it
let _hasRevealed = false;
let _destroyedAt = 0;

/**
 * Animated horizontal ribbon of stacked wavy lines.
 * Uses numpy-ts vectorized sin to compute each wave across the full width.
 */
export function init(canvas: HTMLCanvasElement, container: HTMLElement) {
  // Reset reveal if there was a gap since last destroy (came from a page without masthead)
  // Inner→inner: destroy + init happen back-to-back (<100ms)
  // Home→inner: destroy happened on a previous navigation, gap is large
  const gap = _destroyedAt > 0 ? performance.now() - _destroyedAt : Infinity;
  if (gap > 200) _hasRevealed = false;
  _destroyedAt = 0;

  const ctx = canvas.getContext("2d")!;
  let dpr = 1;
  let w = 0;
  let h = 0;
  let frameId = 0;
  let running = true;
  let frameCount = 0;
  let lastLogTime = 0;

  // Reveal animation: clip from left to right, then fade in contour lines
  const shouldReveal = !_hasRevealed;
  const REVEAL_DURATION = 600;
  const CONTOUR_STAGGER = 150; // ms between each contour pair
  const CONTOUR_FADE = 250; // fade duration per line
  let revealStart = -1;
  let revealProgress = shouldReveal ? 0 : 1;
  let contourElapsed = shouldReveal ? -1 : Infinity;
  if (shouldReveal) _hasRevealed = true;

  // Cache the x-domain linspace so we only rebuild on resize
  let cachedW = 0;
  let xArr: NDArrayCore | null = null;

  function size() {
    dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    w = container.clientWidth;
    h = container.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  size();

  const ro = new ResizeObserver(size);
  ro.observe(container);

  const STEP = 5;

  // Each line: vertical offset, opacity, amplitude, phase
  const LINES = [
    { off: -22, alpha: 0.1, amp: 14, phase: 0.0 },
    { off: -14, alpha: 0.18, amp: 18, phase: 0.4 },
    { off: -7, alpha: 0.32, amp: 22, phase: 0.8 },
    { off: 0, alpha: 0.85, amp: 26, phase: 1.2 }, // main
    { off: 7, alpha: 0.32, amp: 22, phase: 1.6 },
    { off: 14, alpha: 0.18, amp: 18, phase: 2.0 },
    { off: 22, alpha: 0.1, amp: 14, phase: 2.4 },
  ];

  function frame(time: number) {
    if (!running) return;
    _t += 1 / 60;

    if (DEBUG_WASM) {
      frameCount++;
      if (time - lastLogTime > 1000) {
        const free = (wasmFreeBytes as () => number)();
        const total = 32 * 1024 * 1024;
        const used = total - free;
        console.log(
          `[wasm:masthead] ${(used / 1024).toFixed(0)}KB used / ${(total / 1024).toFixed(0)}KB total ` +
            `(${(free / 1024).toFixed(0)}KB free) — ${frameCount} frames/s`,
        );
        frameCount = 0;
        lastLogTime = time;
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Update reveal progress — ease-in (slow start, fast finish)
    if (revealStart < 0 && revealProgress < 1) revealStart = time;
    if (revealProgress < 1) {
      const elapsed = time - revealStart;
      const t = Math.min(1, elapsed / REVEAL_DURATION);
      revealProgress = t * t * t;
      if (revealProgress >= 1) contourElapsed = 0;
    } else if (contourElapsed !== Infinity) {
      if (contourElapsed < 0) contourElapsed = 0;
      else contourElapsed += (1 / 60) * 1000;
    }

    if (w === 0 || h === 0) {
      frameId = requestAnimationFrame(frame);
      return;
    }

    // Apply reveal clip
    if (revealProgress < 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w * revealProgress, h);
      ctx.clip();
    }

    const nPts = Math.ceil(w / STEP) + 1;

    // Rebuild linspace if width changed
    if (nPts !== cachedW) {
      xArr?.dispose();
      xArr = linspace(0, w, nPts);
      cachedW = nPts;
    }

    const yMid = h * 0.55;

    for (const L of LINES) {
      const yOffset = L.phase * 11;

      using s1_inner = multiply(xArr!, 0.0042);
      using s1_shift = add(s1_inner, _t * 0.18 + yOffset * 0.018);
      using s1_raw = sin(s1_shift);
      using s1 = multiply(s1_raw, 0.55);

      using s2_inner = multiply(xArr!, 0.0091);
      using s2_shift = add(s2_inner, -_t * 0.13 + yOffset * 0.011 + 1.7);
      using s2_raw = sin(s2_shift);
      using s2 = multiply(s2_raw, 0.3);

      using s3_inner = multiply(xArr!, 0.0017);
      using s3_shift = add(s3_inner, _t * 0.07 + yOffset * 0.025 + 4.1);
      using s3_raw = sin(s3_shift);
      using s3 = multiply(s3_raw, 0.18);

      using sum12 = add(s1, s2);
      using field = add(sum12, s3);

      const data = field.data as Float64Array;

      ctx.beginPath();
      for (let i = 0; i < nPts; i++) {
        const px = i * STEP;
        const py = yMid + L.off + data[i] * L.amp;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      const isMain = L.off === 0;
      let alpha = L.alpha;
      if (!isMain && contourElapsed !== Infinity) {
        // Stagger: ±7 = tier 0, ±14 = tier 1, ±22 = tier 2
        const tier = Math.round(Math.abs(L.off) / 7) - 1;
        const lineStart = tier * CONTOUR_STAGGER;
        const fade =
          contourElapsed < 0
            ? 0
            : Math.min(1, Math.max(0, (contourElapsed - lineStart) / CONTOUR_FADE));
        alpha = L.alpha * fade;
      }
      ctx.strokeStyle = `rgba(245,247,250,${alpha.toFixed(3)})`;
      ctx.lineWidth = isMain ? 1.1 : 1;
      ctx.stroke();
    }

    // Restore clip
    if (revealProgress < 1) {
      ctx.restore();
    }

    frameId = requestAnimationFrame(frame);
  }

  frameId = requestAnimationFrame(frame);

  // Pause when not visible (tab hidden or scrolled out of viewport)
  let visible = true;
  let tabVisible = true;

  function updateRunning() {
    const shouldRun = visible && tabVisible;
    if (shouldRun && !running) {
      running = true;
      frameId = requestAnimationFrame(frame);
    } else if (!shouldRun && running) {
      running = false;
      cancelAnimationFrame(frameId);
    }
  }

  function onVis() {
    tabVisible = !document.hidden;
    updateRunning();
  }
  document.addEventListener("visibilitychange", onVis);

  // 200px safety margin so animation resumes before scrolling into view
  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      updateRunning();
    },
    { rootMargin: "200px 0px" },
  );
  io.observe(container);

  return function destroy() {
    running = false;
    _destroyedAt = performance.now();
    cancelAnimationFrame(frameId);
    ro.disconnect();
    io.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    xArr?.dispose();
    xArr = null;
    cachedW = 0;
  };
}
