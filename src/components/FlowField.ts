import {
  add,
  cos,
  divide,
  exp,
  linspace,
  max,
  multiply,
  ones,
  outer,
  sin,
  sqrt,
  subtract,
  type NDArrayCore,
} from "numpy-ts/core";

// --- Math utilities ---

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function damp(current: number, target: number, easing: number) {
  return current + (target - current) * easing;
}

function createGrid(cols: number, rows: number) {
  const x = linspace(-1, 1, cols);
  const y = linspace(-1, 1, rows);
  const X = outer(ones([rows]), x);
  const Y = outer(y, ones([cols]));
  return { X, Y };
}

// --- Seed state ---

interface Seed {
  x: number;
  y: number;
  strength: number;
  decay: number;
  pulse: number;
}

// --- Field computation ---

function buildField(
  cols: number,
  rows: number,
  time: number,
  pointerX: number,
  pointerY: number,
  pointerEnergy: number,
  seeds: Seed[],
) {
  const { X, Y } = createGrid(cols, rows);
  const drift = time * 0.00008;

  // Base sinusoidal flow
  let u = add(
    sin(add(multiply(Y, 2.2), drift * 7.5)),
    multiply(cos(add(multiply(X, 3.4), drift * 4.8)), 0.62),
  );
  let v = add(
    cos(subtract(multiply(X, 2.35), drift * 7.2)),
    multiply(sin(add(multiply(Y, 2.55), drift * 3.7)), 0.5),
  );

  // Pointer influence
  const dx = subtract(X, pointerX);
  const dy = subtract(Y, pointerY);
  const distanceSq = add(multiply(dx, dx), multiply(dy, dy));
  const envelope = exp(divide(distanceSq, -(0.055 + pointerEnergy * 0.085)));
  const swirl = multiply(envelope, 1.4 + pointerEnergy * 2.6);

  u = add(u, multiply(multiply(dy, -1), swirl));
  v = add(v, multiply(dx, swirl));

  // Seed influences
  for (const seed of seeds) {
    const localDx = subtract(X, seed.x);
    const localDy = subtract(Y, seed.y);
    const localDistance = add(
      multiply(localDx, localDx),
      multiply(localDy, localDy),
    );
    const envelopeScale = 0.03 + seed.decay * 0.075;
    const localEnvelope = exp(divide(localDistance, -envelopeScale));
    const strength = seed.strength * seed.decay;
    const localPush = multiply(localEnvelope, strength);
    const localSwirl = multiply(localEnvelope, strength * 0.24);

    u = add(u, multiply(localDx, localPush));
    v = add(v, multiply(localDy, localPush));
    u = add(u, multiply(multiply(localDy, -1), localSwirl));
    v = add(v, multiply(localDx, localSwirl));
  }

  const magnitude = sqrt(add(add(multiply(u, u), multiply(v, v)), 1e-6));
  return {
    X,
    Y,
    u: divide(u, magnitude),
    v: divide(v, magnitude),
    magnitude,
  };
}

// --- Pointer tracking ---

interface PointerState {
  x: number;
  y: number;
  nx: number;
  ny: number;
  speed: number;
  inside: boolean;
  down: boolean;
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
    down: false,
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
  const onLeave = () => {
    pointer.inside = false;
    pointer.speed = 0;
  };
  const onDown = () => {
    pointer.down = true;
  };
  const onUp = () => {
    pointer.down = false;
  };

  container.addEventListener("pointermove", onMove);
  container.addEventListener("pointerenter", onEnter);
  container.addEventListener("pointerleave", onLeave);
  container.addEventListener("pointerdown", onDown);
  window.addEventListener("pointerup", onUp);

  return {
    state: pointer,
    destroy() {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerenter", onEnter);
      container.removeEventListener("pointerleave", onLeave);
      container.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
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
  let seeds: Seed[] = [];

  // Click to place seeds — invert the margin transform so seeds render at the cursor
  function onClick(event: MouseEvent) {
    const rect = container.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const marginX = rect.width * 0.07;
    const marginY = rect.height * 0.08;
    const usableWidth = rect.width - marginX * 2;
    const usableHeight = rect.height - marginY * 2;
    const x = ((px - marginX) / usableWidth) * 2 - 1;
    const y = ((py - marginY) / usableHeight) * 2 - 1;
    seeds = [{ x, y, strength: 3.35, decay: 1, pulse: 1 }, ...seeds].slice(
      0,
      6,
    );
  }

  container.addEventListener("click", onClick);

  const ctx = canvas.getContext("2d")!;
  let frameId = 0;

  function frame(time: number) {
    frameId = requestAnimationFrame(frame);

    const { width, height, dpr } = metrics;
    if (width === 0 || height === 0) return;

    // Update energy
    energy = damp(
      energy,
      pointer.inside
        ? clamp(pointer.speed * 9 + (pointer.down ? 0.35 : 0.08), 0, 1.2)
        : 0,
      0.035,
    );

    // Decay seeds
    seeds = seeds
      .map((s) => ({ ...s, decay: s.decay * 0.993, pulse: s.pulse * 0.72 }))
      .filter((s) => s.decay > 0.08);

    // Compute field
    const cols = clamp(Math.floor(width / FIELD_SPACING), 24, 56);
    const rows = clamp(Math.floor(height / FIELD_SPACING), 18, 36);
    const pointerX = pointer.nx * 2 - 1;
    const pointerY = pointer.ny * 2 - 1;
    const field = buildField(cols, rows, time, pointerX, pointerY, energy, seeds);

    const xData = field.X.data as Float64Array;
    const yData = field.Y.data as Float64Array;
    const uData = field.u.data as Float64Array;
    const vData = field.v.data as Float64Array;
    const magnitudeData = field.magnitude.data as Float64Array;
    const magnitudeMax = Math.max(1e-6, Number(max(field.magnitude)));

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
      const px = marginX + ((xData[i] + 1) * 0.5) * usableWidth;
      const py = marginY + ((yData[i] + 1) * 0.5) * usableHeight;
      const ratio = clamp(magnitudeData[i] / magnitudeMax, 0, 1);
      const len = FIELD_LENGTH + ratio * 8;
      const dx = uData[i] * len;
      const dy = vData[i] * len;

      // Skip vectors near seeds
      let nearSeed = false;
      for (const seed of seeds) {
        const sx = marginX + ((seed.x + 1) * 0.5) * usableWidth;
        const sy = marginY + ((seed.y + 1) * 0.5) * usableHeight;
        if (Math.hypot(px - sx, py - sy) < 24) {
          nearSeed = true;
          break;
        }
      }
      if (nearSeed) continue;

      ctx.beginPath();
      ctx.moveTo(px - dx * 0.44, py - dy * 0.44);
      ctx.lineTo(px + dx * 0.56, py + dy * 0.56);
      ctx.strokeStyle = `rgba(245, 247, 250, ${0.1 + ratio * 0.52})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Draw seed effects
    for (const seed of seeds) {
      const px = marginX + ((seed.x + 1) * 0.5) * usableWidth;
      const py = marginY + ((seed.y + 1) * 0.5) * usableHeight;
      const radius = 12 + seed.decay * 26;
      const pulseRadius = radius + (1 - seed.pulse) * 10;

      const grad = ctx.createRadialGradient(px, py, 0, px, py, radius * 1.35);
      grad.addColorStop(0, "rgba(245, 247, 250, 0.08)");
      grad.addColorStop(1, "rgba(245, 247, 250, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, radius * 1.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, pulseRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(245, 247, 250, ${seed.pulse * 0.1})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(245, 247, 250, ${0.08 + seed.decay * 0.22})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Pointer glow
    if (pointer.inside) {
      const r = 30 + energy * 44;
      const grad = ctx.createRadialGradient(
        pointer.x, pointer.y, 0,
        pointer.x, pointer.y, r,
      );
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
    container.removeEventListener("click", onClick);
    destroyPointer();
    destroyCanvas();
  };
}
