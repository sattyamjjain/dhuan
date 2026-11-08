import { t, tn } from '../../i18n/index.js';
import {
  GEBCO_STACK_ID,
  PLATE_CLASS_COLORS,
  PLATE_LEGEND_CLASSES,
  SEAFLOOR_FALLBACK_STACK_ID,
  SEAFLOOR_FAMILY_COLORS,
  SEAFLOOR_LAYER_ID,
  SEAFLOOR_LEGEND_FAMILIES,
  SEAFLOOR_MAP_REQUEST_TIMEOUT_MS,
  SEAFLOOR_NAME_MODES,
} from './policy.js';
import {
  seafloorClassificationTypeForScene,
  seafloorClassificationTypeForStack,
} from './surface.js';

/** Legend row labels, in SEAFLOOR_LEGEND_FAMILIES order. */
function familyLegendLabel(family) {
  switch (family) {
    case 'trench':
      return t('Trenches & troughs');
    case 'ridge':
      return t('Ridges & rises');
    case 'plain':
      return t('Plains & basins');
    case 'fracture':
      return t('Fracture zones & escarpments');
    case 'plateau':
      return t('Plateaus, banks & shelves');
    case 'high':
      return t('Seamounts & guyots');
    case 'channel':
      return t('Canyons & channels');
    default:
      return t('Other named features');
  }
}

function plateLegendLabel(code) {
  switch (code) {
    case 'OSR':
      return t('Spreading ridges');
    case 'SUB':
      return t('Subduction zones');
    default:
      return t('Transform faults');
  }
}

export function createLifecycle({
  state,
  parts,
  source,
  mapStackEventTarget,
  requestMapStack,
  removeEntityContextsForLayer,
  clearSelectedEntityContextForLayer,
}) {
  const notifyRowControls = () => {
    try {
      state._rowControlsListener?.();
    } catch (error) {
      console.warn(`[Data:${SEAFLOOR_LAYER_ID}] row controls listener`, error);
    }
  };
  parts.notifyRowControls = notifyRowControls;

  function dropContexts() {
    removeEntityContextsForLayer?.(SEAFLOOR_LAYER_ID);
    clearSelectedEntityContextForLayer?.(SEAFLOOR_LAYER_ID);
  }

  function settleMapStackRequest() {
    if (state._mapStackRequestTimer) clearTimeout(state._mapStackRequestTimer);
    state._mapStackRequestTimer = null;
    state._mapStackRequestPending = false;
  }

  /**
   * Track the active stack for the chip and re-classify the ground lines.
   * The chip's active state follows this event only, never the click: the
   * shell may refuse the request or fall back to another stack.
   */
  function onMapStackChanged(event) {
    const activeId = event?.detail?.activeId || null;
    if (activeId === GEBCO_STACK_ID && state._activeStackId !== GEBCO_STACK_ID)
      state._previousStackId = state._activeStackId;
    state._activeStackId = activeId;
    settleMapStackRequest();
    parts.rendering.applyClassification(
      activeId
        ? seafloorClassificationTypeForStack(activeId)
        : seafloorClassificationTypeForScene(state._viewer?.scene),
    );
    notifyRowControls();
  }

  /** Ask the shell for the GEBCO relief, or for the stack it replaced. */
  function toggleGebcoStack() {
    if (typeof requestMapStack !== 'function') return;
    settleMapStackRequest();
    state._mapStackRequestPending = true;
    const timer = setTimeout(() => {
      if (state._mapStackRequestTimer !== timer) return;
      settleMapStackRequest();
      notifyRowControls();
    }, SEAFLOOR_MAP_REQUEST_TIMEOUT_MS);
    // Under Node (tests) a live timer would hold the process open.
    timer.unref?.();
    state._mapStackRequestTimer = timer;
    requestMapStack(
      state._activeStackId === GEBCO_STACK_ID
        ? state._previousStackId || SEAFLOOR_FALLBACK_STACK_ID
        : GEBCO_STACK_ID,
    );
    notifyRowControls();
  }

  function subscribeCamera(viewer) {
    if (!state._preRenderRemover) {
      state._preRenderRemover = viewer.scene.preRender.addEventListener(() => {
        // The camera is handed to the gate so tracked/orbit cameras, which
        // never emit moveEnd, reach the motion fallback.
        if (
          !state._enabled ||
          !state._loaded ||
          !state._sweepGate.shouldRun(viewer.camera, state._cameraHeightM)
        )
          return;
        parts.rendering.updateVisibilitySweep();
      });
    }
    if (!state._moveEndRemover) {
      state._moveEndRemover = viewer.camera.moveEnd.addEventListener(() => {
        if (!state._enabled) return;
        state._sweepGate.markDirty();
        viewer.scene.requestRender?.();
      });
    }
  }

  function unsubscribeAll() {
    if (state._clickHandler) {
      state._clickHandler.destroy();
      state._clickHandler = null;
    }
    state._preRenderRemover?.();
    state._preRenderRemover = null;
    state._moveEndRemover?.();
    state._moveEndRemover = null;
    if (state._mapStackListener && mapStackEventTarget?.removeEventListener) {
      mapStackEventTarget.removeEventListener(
        'gev:map-stack-changed',
        state._mapStackListener,
      );
    }
    state._mapStackListener = null;
  }

  /** Each names mode is its own chip, so the active one reads as a state, not a toggle. */
  function buildChips() {
    const params = state._params;
    const chips = [
      {
        id: 'plates',
        label: t('Plate boundaries'),
        active: params.plates === true,
        params: { plates: !params.plates },
        title: t('Show PB2002 plate boundaries'),
      },
      {
        id: 'names-major',
        label: t('Major names'),
        active: params.names === 'major',
        params: { names: 'major' },
      },
      {
        id: 'names-all',
        label: t('All names'),
        active: params.names === 'all',
        params: { names: 'all' },
      },
    ];
    if (typeof requestMapStack === 'function') {
      chips.push({
        id: 'gebco-map',
        label: t('Sea floor map'),
        active: state._activeStackId === GEBCO_STACK_ID,
        busy: state._mapStackRequestPending,
        title: t(
          'Switch the whole map to the GEBCO sea-floor relief, and back',
        ),
        onClick: toggleGebcoStack,
      });
    }
    return chips;
  }

  /** Provenance and live status go in the always-visible info, never a hover blurb. */
  function buildInfo() {
    const lines = [
      t(
        'Names from the IHO-IOC GEBCO Gazetteer. Small features name themselves when you zoom in or click them.',
      ),
    ];
    if (state._loaded)
      lines.push(
        tn(
          state._labelCount,
          '{count} name on screen',
          '{count} names on screen',
        ),
      );
    if (state._activeStackId === GEBCO_STACK_ID)
      lines.push(t('Basemap: GEBCO sea floor'));
    return lines.join('\n');
  }

  function buildLegend() {
    const loaded = state._loaded;
    const legend = SEAFLOOR_LEGEND_FAMILIES.map((family) => ({
      label: familyLegendLabel(family),
      color: SEAFLOOR_FAMILY_COLORS[family],
      count: loaded ? state._familyCounts[family] || 0 : undefined,
    }));
    if (state._params.plates === true) {
      for (const code of PLATE_LEGEND_CLASSES) {
        legend.push({
          label: plateLegendLabel(code),
          color: PLATE_CLASS_COLORS[code],
          count: loaded ? state._plateClassCounts[code] || 0 : undefined,
        });
      }
    }
    return legend;
  }

  return {
    id: SEAFLOOR_LAYER_ID,
    name: 'Sea floor features',
    icon: '⛰',
    source: source.label,
    updateInterval: 0,
    statsRefreshInterval: 500,

    init(viewer) {
      state._viewer = viewer;
      state._classificationType = seafloorClassificationTypeForScene(
        viewer?.scene,
      );
      if (!state._mapStackListener && mapStackEventTarget?.addEventListener) {
        state._mapStackListener = onMapStackChanged;
        mapStackEventTarget.addEventListener(
          'gev:map-stack-changed',
          state._mapStackListener,
        );
      }
      parts.interaction.beginInteraction(viewer);
      subscribeCamera(viewer);
    },

    enable(viewer) {
      state._enabled = true;
      parts.rendering.updateVisibility();
      state._overlayPublisher.show();
      // A hide() cleared the host source, so an identical cohort must still
      // republish on the next sweep.
      parts.rendering.resetPublishSignature();
      state._sweepGate.markDirty();
      (viewer || state._viewer)?.scene?.requestRender?.();
      void parts.ingestion.load(viewer || state._viewer);
    },

    disable() {
      state._enabled = false;
      state._overlayPublisher.hide();
      parts.rendering.resetPublishSignature();
      if (state._loading && state._abort) {
        state._abort.abort();
        state._loading = false;
        state._loadingLabel = '';
      }
      // Free the entities rather than hide them; enable() rebuilds from the
      // cached bundle and re-registers every context.
      parts.rendering.releaseDataSources(state._viewer);
      dropContexts();
    },

    update(viewer) {
      return parts.ingestion.load(viewer || state._viewer);
    },

    destroy(viewer) {
      if (state._abort) state._abort.abort();
      parts.rendering.releaseDataSources(viewer || state._viewer);
      dropContexts();
      state._cachedBundle = null;
      state._overlayPublisher.hide();
      unsubscribeAll();
      settleMapStackRequest();
      state._viewer = null;
      state._enabled = false;
      state._loading = false;
      state._loaded = false;
      state._count = 0;
      state._plateCount = 0;
      state._error = null;
      state._lastUpdate = null;
      state._loadingLabel = '';
      state._familyCounts = {};
      state._plateClassCounts = {};
      state._labelCount = 0;
      state._cameraHeightM = null;
      state._activeStackId = null;
      state._previousStackId = null;
      parts.rendering.resetPublishSignature();
      state._sweepGate.reset();
    },

    getStats() {
      return {
        count: state._count,
        lastUpdate: state._lastUpdate,
        loading: state._loading,
        loadingLabel: state._loadingLabel,
        error: state._error,
        plateCount: state._plateCount,
        labelCount: state._labelCount,
      };
    },

    getParams() {
      return { ...state._params };
    },

    /**
     * Apply `plates` and `names`. Both are session-only (the registry
     * disposition is enabled-only), so nothing is persisted here.
     * @param {{plates?:boolean,names?:string}} [params]
     * @returns {boolean}
     */
    setParams(params = {}) {
      let changed = false;
      if (
        typeof params.plates === 'boolean' &&
        params.plates !== state._params.plates
      ) {
        state._params.plates = params.plates;
        changed = true;
      }
      if (
        SEAFLOOR_NAME_MODES.includes(params.names) &&
        params.names !== state._params.names
      ) {
        state._params.names = params.names;
        changed = true;
      }
      if (changed) {
        parts.rendering.updateVisibility();
        parts.rendering.resetPublishSignature();
        state._sweepGate.markDirty();
        state._viewer?.scene?.requestRender?.();
        notifyRowControls();
      }
      return true;
    },

    getRowControls() {
      return { chips: buildChips(), legend: buildLegend(), info: buildInfo() };
    },

    setRowControlsListener(listener) {
      state._rowControlsListener =
        typeof listener === 'function' ? listener : null;
    },
  };
}
