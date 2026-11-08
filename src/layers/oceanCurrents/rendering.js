import { createFlowClock } from './animation.js';
import { createOceanCurrentGpuRendering } from './gpuRendering.js';
import { ACTIVATE_FLIGHT_SECONDS, ACTIVATE_HEIGHT_METERS } from './policy.js';
import {
  createCurrentOverlayPublisher,
  currentOverlayEntries,
} from './overlay.js';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Compose the GPU owner, the flow clock and the label publisher. Scene events
 * repaint only changed views; the clock runs only while something is visible
 * and motion is wanted, so a paused or reduced-motion layer costs no frames.
 * @param {object} options
 * @param {object} options.cesium
 * @param {function(): object} options.getViewer
 * @param {object} options.overlayHost
 * @param {function(): void} [options.onStatusChange]
 * @param {function} [options.createGpuRendering] Test seam.
 * @param {function} [options.createClock] Test seam.
 * @param {function(string): object|null} [options.matchMedia] Test seam.
 * @param {object} [options.documentRef] Test seam for `hidden`.
 */
export function createOceanCurrentRendering({
  cesium,
  getViewer,
  overlayHost,
  onStatusChange,
  createGpuRendering = createOceanCurrentGpuRendering,
  createClock = createFlowClock,
  matchMedia = (query) => globalThis.matchMedia?.(query) ?? null,
  documentRef = globalThis.document,
} = {}) {
  let running = false;
  let paused = false;
  let reducedMotion = false;
  let gpuActive = false;
  let gpuVisible = false;
  let labelsShown = false;
  let reportedReady = null;
  let entries = [];
  let media = null;
  let removers = [];
  const gpu = createGpuRendering({ cesium, getViewer });
  const publisher = createCurrentOverlayPublisher({ host: overlayHost });
  const hidden = () => documentRef?.hidden === true;
  const still = () => paused || reducedMotion;
  const viewerReady = () => {
    const viewer = getViewer?.();
    return viewer && !viewer.isDestroyed?.() ? viewer : null;
  };
  const requestRender = () => viewerReady()?.scene?.requestRender?.();
  const clock = createClock({
    canRun: () => running && gpuActive && gpuVisible && !hidden() && !still(),
    onFrame(flowTime) {
      gpu.tick(flowTime);
      requestRender();
    },
  });

  /**
   * Keyboard or assistive activation of a label: centre the camera over the
   * current at globe scale. The primitives stay unpickable; this is the
   * host's accessible route to the same place a sighted user pans to.
   */
  function flyToCurrent(record) {
    const viewer = viewerReady();
    if (typeof viewer?.camera?.flyTo !== 'function') return false;
    viewer.camera.flyTo({
      destination: cesium.Cartesian3.fromDegrees(
        record.reference[0],
        record.reference[1],
        ACTIVATE_HEIGHT_METERS,
      ),
      duration: reducedMotion ? 0 : ACTIVATE_FLIGHT_SECONDS,
    });
    return true;
  }

  function hideLabels() {
    if (!labelsShown) return;
    publisher.hide();
    labelsShown = false;
  }

  /** Labels follow the drawing: gone while the schematic is faded out. */
  function syncLabels(heightFade) {
    if (!running || !gpuActive || heightFade <= 0) {
      hideLabels();
      return;
    }
    if (labelsShown) return;
    publisher.show();
    publisher.publish(entries);
    labelsShown = true;
  }

  function viewChanged() {
    if (!running || !gpuActive) return;
    const viewer = viewerReady();
    if (!viewer) return;
    gpuVisible = gpu.updateVisibility(viewer.scene.camera);
    // One diagnostics read per frame: this runs on every preRender.
    const { heightFade, ready } = gpu.getDiagnostics();
    syncLabels(heightFade);
    clock.poke();
    if (ready !== reportedReady) {
      reportedReady = ready;
      onStatusChange?.();
    }
  }

  function motionChanged() {
    reducedMotion = media?.matches === true;
    gpu.setOptions({ paused: still() });
    if (!running || !gpuActive) return;
    // One static frame paints the brighter ghost dashes; the asymmetric
    // taper still shows direction at rest.
    requestRender();
    viewChanged();
  }

  function wake() {
    viewChanged();
    // A parked request-render scene may never run preRender until woken.
    if (running && gpuActive) requestRender();
  }

  function listen(target, event, callback) {
    if (!target?.addEventListener) return;
    target.addEventListener(event, callback);
    removers.push(() => target.removeEventListener(event, callback));
  }

  function listenScene(event, callback) {
    if (!event?.addEventListener) return;
    const remove = event.addEventListener(callback);
    removers.push(
      typeof remove === 'function'
        ? remove
        : () => event.removeEventListener(callback),
    );
  }

  function attachListeners() {
    if (removers.length) return;
    media = matchMedia?.(REDUCED_MOTION_QUERY) ?? null;
    reducedMotion = media?.matches === true;
    listen(media, 'change', motionChanged);
    listen(documentRef, 'visibilitychange', motionChanged);
    const viewer = viewerReady();
    listenScene(viewer?.scene?.preRender, viewChanged);
    listenScene(viewer?.scene?.camera?.moveEnd, wake);
  }

  function detachListeners() {
    for (const remove of removers) remove();
    removers = [];
    media = null;
  }

  function clear() {
    clock.reset();
    hideLabels();
    gpu.clear();
    gpuActive = false;
    gpuVisible = false;
    reportedReady = null;
    entries = [];
  }

  function stop() {
    running = false;
    clock.stop();
    detachListeners();
    hideLabels();
  }

  return {
    /** Replace the drawn set; returns whether the GPU path accepted it. */
    setCurrents(records) {
      clear();
      gpuActive = gpu.supported() && gpu.setCurrents(records);
      reportedReady = gpuActive ? gpu.getDiagnostics().ready : null;
      entries = gpuActive
        ? currentOverlayEntries(records, cesium, { activate: flyToCurrent })
        : [];
      if (running) motionChanged();
      return gpuActive;
    },
    setOptions(options = {}) {
      if (typeof options.paused !== 'boolean' || options.paused === paused)
        return;
      paused = options.paused;
      motionChanged();
    },
    start() {
      if (running) return;
      running = true;
      attachListeners();
      clock.start();
      motionChanged();
    },
    stop,
    clear,
    destroy() {
      stop();
      clear();
      gpu.destroy();
    },
    getDiagnostics() {
      return {
        ...gpu.getDiagnostics(),
        paused,
        reducedMotion,
        hidden: hidden(),
        gpuActive,
        gpuVisible,
        labelsShown,
        framePending: clock.isPending(),
        flowTime: clock.getFlowTime(),
      };
    },
  };
}
