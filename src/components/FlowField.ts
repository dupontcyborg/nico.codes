import {
  add,
  configureWasm,
  cos,
  divide,
  exp,
  linspace,
  max,
  multiply,
  type NDArrayCore,
  ones,
  outer,
  sin,
  sqrt,
  subtract,
  wasmFreeBytes,
} from "numpy-ts/core";

// Guard: configureWasm throws if called after WASM is already initialized
// (happens when Astro View Transitions re-evaluate this module)
try {
  configureWasm({ maxMemory: 32 * 1024 * 1024 });
} catch {}

const DEBUG_WASM = import.meta.env.DEV;

// --- Math utilities ---

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function damp(current: number, target: number, easing: number) {
  return current + (target - current) * easing;
}

// --- Grid cache ---

let _gridCols = 0;
let _gridRows = 0;
let _X: NDArrayCore;
let _Y: NDArrayCore;

function getGrid(cols: number, rows: number) {
  if (cols !== _gridCols || rows !== _gridRows) {
    _X?.dispose();
    _Y?.dispose();
    const x = linspace(-1, 1, cols);
    const y = linspace(-1, 1, rows);
    _X = outer(ones([rows]), x);
    _Y = outer(y, ones([cols]));
    x.dispose();
    y.dispose();
    _gridCols = cols;
    _gridRows = rows;
  }
  return { X: _X, Y: _Y };
}

// --- Field computation ---

function buildField(
  cols: number,
  rows: number,
  time: number,
  pointerX: number,
  pointerY: number,
  pointerEnergy: number,
) {
  const { X, Y } = getGrid(cols, rows);
  const drift = time * 0.00008;

  // u = sin(Y*2.2 + drift*7.5) + cos(X*3.4 + drift*4.8)*0.62
  using t0 = multiply(Y, 2.2);
  using t1 = add(t0, drift * 7.5);
  using t2 = sin(t1);
  using t3 = multiply(X, 3.4);
  using t4 = add(t3, drift * 4.8);
  using t5 = cos(t4);
  using t6 = multiply(t5, 0.62);
  let u = add(t2, t6);

  // v = cos(X*2.35 - drift*7.2) + sin(Y*2.55 + drift*3.7)*0.5
  using t7 = multiply(X, 2.35);
  using t8 = subtract(t7, drift * 7.2);
  using t9 = cos(t8);
  using t10 = multiply(Y, 2.55);
  using t11 = add(t10, drift * 3.7);
  using t12 = sin(t11);
  using t13 = multiply(t12, 0.5);
  let v = add(t9, t13);

  // Pointer influence
  {
    using dx = subtract(X, pointerX);
    using dy = subtract(Y, pointerY);
    using dxSq = multiply(dx, dx);
    using dySq = multiply(dy, dy);
    using distSq = add(dxSq, dySq);
    using scaled = divide(distSq, -(0.055 + pointerEnergy * 0.085));
    using envelope = exp(scaled);
    using swirl = multiply(envelope, 1.4 + pointerEnergy * 2.6);

    using negDy = multiply(dy, -1);
    using swirlDy = multiply(negDy, swirl);
    {
      using old = u;
      u = add(old, swirlDy);
    }

    using swirlDx = multiply(dx, swirl);
    {
      using old = v;
      v = add(old, swirlDx);
    }
  }

  // Normalization
  using uSq = multiply(u, u);
  using vSq = multiply(v, v);
  using sumSq = add(uSq, vSq);
  using sumEps = add(sumSq, 1e-6);
  const magnitude = sqrt(sumEps);
  {
    using old = u;
    u = divide(old, magnitude);
  }
  {
    using old = v;
    v = divide(old, magnitude);
  }

  return { X, Y, u, v, magnitude };
}

// --- Pointer tracking ---

interface PointerState {
  x: number;
  y: number;
  nx: number;
  ny: number;
  speed: number;
  inside: boolean;
}

function trackPointer(container: HTMLElement): {
  state: PointerState;
  destroy: () => void;
} {
  const pointer: PointerState = {
    x: 0,
    y: 0,
    nx: 0,
    ny: 0,
    speed: 0,
    inside: false,
  };

  let lastX = 0;
  let lastY = 0;
  let lastTime = performance.now();

  function update(event: PointerEvent, inside: boolean) {
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const now = performance.now();
    const dt = Math.max(16, now - lastTime);
    const vx = (x - lastX) / dt;
    const vy = (y - lastY) / dt;

    pointer.x = x;
    pointer.y = y;
    pointer.nx = rect.width > 0 ? x / rect.width : 0.5;
    pointer.ny = rect.height > 0 ? y / rect.height : 0.5;
    pointer.speed = Math.hypot(vx, vy);
    pointer.inside = inside;

    lastX = x;
    lastY = y;
    lastTime = now;
  }

  const onMove = (e: PointerEvent) => update(e, true);
  const onEnter = (e: PointerEvent) => update(e, true);
  const onDown = (e: PointerEvent) => update(e, true);
  const onLeave = (e: PointerEvent) => {
    // Touch: lifting a finger fires pointerleave immediately. Keep the swirl
    // anchored at the last touch position so the field can decay gracefully.
    if (e.pointerType !== "mouse") {
      pointer.speed = 0;
      return;
    }
    pointer.inside = false;
    pointer.speed = 0;
  };
  const onUp = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") {
      pointer.inside = false;
      pointer.speed = 0;
    }
  };

  container.addEventListener("pointermove", onMove);
  container.addEventListener("pointerenter", onEnter);
  container.addEventListener("pointerleave", onLeave);
  container.addEventListener("pointerdown", onDown);
  container.addEventListener("pointerup", onUp);
  container.addEventListener("pointercancel", onUp);

  return {
    state: pointer,
    destroy() {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerenter", onEnter);
      container.removeEventListener("pointerleave", onLeave);
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onUp);
    },
  };
}

// --- Canvas sizing ---

function setupCanvas(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
): { metrics: { width: number; height: number; dpr: number }; destroy: () => void } {
  const metrics = { width: 0, height: 0, dpr: 1 };

  function resize() {
    const rect = container.getBoundingClientRect();
    metrics.width = Math.max(1, Math.round(rect.width));
    metrics.height = Math.max(1, Math.round(rect.height));
    metrics.dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(metrics.width * metrics.dpr);
    canvas.height = Math.round(metrics.height * metrics.dpr);
    canvas.style.width = `${metrics.width}px`;
    canvas.style.height = `${metrics.height}px`;
  }

  resize();

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  window.addEventListener("resize", resize);

  return {
    metrics,
    destroy() {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    },
  };
}

// --- Main entry ---

const FIELD_SPACING = 24;
const FIELD_LENGTH = 11;

export function init(canvas: HTMLCanvasElement, container: HTMLElement) {
  const { metrics, destroy: destroyCanvas } = setupCanvas(canvas, container);
  const { state: pointer, destroy: destroyPointer } = trackPointer(container);

  let energy = 0;

  // Previous frame's field results (disposed each frame)
  let prevField: { u: NDArrayCore; v: NDArrayCore; magnitude: NDArrayCore } | null = null;

  const ctx =
    canvas.getContext("2d") ??
    (() => {
      throw new Error("2d canvas context unavailable");
    })();
  let frameId = 0;
  let frameCount = 0;
  let lastLogTime = 0;

  function frame(time: number) {
    frameId = requestAnimationFrame(frame);

    if (DEBUG_WASM) {
      frameCount++;
      if (time - lastLogTime > 1000) {
        const free = (wasmFreeBytes as () => number)();
        const total = 32 * 1024 * 1024;
        const used = total - free;
        console.log(
          `[wasm:field] ${(used / 1024).toFixed(0)}KB used / ${(total / 1024).toFixed(0)}KB total ` +
            `(${(free / 1024).toFixed(0)}KB free) — ${frameCount} frames/s`,
        );
        frameCount = 0;
        lastLogTime = time;
      }
    }

    const { width, height, dpr } = metrics;
    if (width === 0 || height === 0) return;

    // Update energy
    energy = damp(energy, pointer.inside ? clamp(pointer.speed * 9 + 0.08, 0, 1.2) : 0, 0.035);

    // Dispose previous frame's output arrays
    if (prevField) {
      prevField.u.dispose();
      prevField.v.dispose();
      prevField.magnitude.dispose();
      prevField = null;
    }

    // Compute field
    const cols = clamp(Math.floor(width / FIELD_SPACING), 24, 56);
    const rows = clamp(Math.floor(height / FIELD_SPACING), 18, 36);
    const pointerX = pointer.nx * 2 - 1;
    const pointerY = pointer.ny * 2 - 1;
    const field = buildField(cols, rows, time, pointerX, pointerY, energy);

    const xData = field.X.data as Float64Array;
    const yData = field.Y.data as Float64Array;
    const uData = field.u.data as Float64Array;
    const vData = field.v.data as Float64Array;
    const magnitudeData = field.magnitude.data as Float64Array;
    const magnitudeMax = Math.max(1e-6, Number(max(field.magnitude)));

    // Stash for disposal next frame
    prevField = { u: field.u, v: field.v, magnitude: field.magnitude };

    // Draw
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(5, 6, 7, 1)";
    ctx.fillRect(0, 0, width, height);
    ctx.lineCap = "round";

    const marginX = width * 0.07;
    const marginY = height * 0.08;
    const usableWidth = width - marginX * 2;
    const usableHeight = height - marginY * 2;

    for (let i = 0; i < xData.length; i++) {
      const px = marginX + (xData[i] + 1) * 0.5 * usableWidth;
      const py = marginY + (yData[i] + 1) * 0.5 * usableHeight;
      const ratio = clamp(magnitudeData[i] / magnitudeMax, 0, 1);
      const len = FIELD_LENGTH + ratio * 8;
      const dx = uData[i] * len;
      const dy = vData[i] * len;

      ctx.beginPath();
      ctx.moveTo(px - dx * 0.44, py - dy * 0.44);
      ctx.lineTo(px + dx * 0.56, py + dy * 0.56);
      ctx.strokeStyle = `rgba(245, 247, 250, ${0.1 + ratio * 0.52})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Pointer glow
    if (pointer.inside) {
      const r = 30 + energy * 44;
      const grad = ctx.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, r);
      grad.addColorStop(0, "rgba(245, 247, 250, 0.1)");
      grad.addColorStop(1, "rgba(245, 247, 250, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  frameId = requestAnimationFrame(frame);

  return function destroy() {
    cancelAnimationFrame(frameId);
    destroyPointer();
    destroyCanvas();
    if (prevField) {
      prevField.u.dispose();
      prevField.v.dispose();
      prevField.magnitude.dispose();
    }
  };
}
