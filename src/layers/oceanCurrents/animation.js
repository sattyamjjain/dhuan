import { FLOW_FRAME_INTERVAL_SECONDS } from './policy.js';

/**
 * The wind rAF loop without the canvas: a frame is scheduled only while
 * `canRun()` holds, frames closer together than the interval are skipped so
 * the GPU uniform updates at 30 Hz, and `onFrame` receives the accumulated
 * flow time in seconds. The clock takes no render-governor hold (wind
 * precedent); whoever owns the scene requests its render inside `onFrame`.
 * @param {object} options
 * @param {function(): number} [options.now] Milliseconds, monotonic.
 * @param {function(function): *} [options.requestFrame]
 * @param {function(*): void} [options.cancelFrame]
 * @param {function(): boolean} [options.canRun]
 * @param {function(number): void} options.onFrame
 * @param {number} [options.minFrameSeconds]
 */
export function createFlowClock({
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
  cancelFrame = (handle) => globalThis.cancelAnimationFrame(handle),
  canRun = () => true,
  onFrame,
  minFrameSeconds = FLOW_FRAME_INTERVAL_SECONDS,
} = {}) {
  let running = false;
  let handle = null;
  let lastTime = null;
  let flowTime = 0;

  function cancel() {
    if (handle !== null) cancelFrame(handle);
    handle = null;
    lastTime = null;
  }

  function frame() {
    handle = null;
    if (!running || !canRun()) {
      lastTime = null;
      return;
    }
    const time = now();
    const elapsed =
      lastTime === null ? 1 / 60 : Math.max(0, (time - lastTime) / 1000);
    if (lastTime === null || elapsed >= minFrameSeconds) {
      flowTime += elapsed;
      onFrame?.(flowTime);
      lastTime = time;
    }
    schedule();
  }

  function schedule() {
    if (running && handle === null && canRun()) handle = requestFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      schedule();
    },
    stop() {
      running = false;
      cancel();
    },
    /** Re-evaluate `canRun()`: schedule when it holds, drop the pending frame when it does not. */
    poke() {
      if (!running) return;
      if (canRun()) schedule();
      else cancel();
    },
    isRunning: () => running,
    isPending: () => handle !== null,
    getFlowTime: () => flowTime,
    reset() {
      flowTime = 0;
      lastTime = null;
    },
  };
}
