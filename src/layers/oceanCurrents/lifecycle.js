import { t } from '../../i18n/index.js';
import { COLD_COLOR, OCEAN_CURRENTS_LAYER_ID, WARM_COLOR } from './policy.js';

/**
 * The layer descriptor the data manager drives. Rendering is created at
 * init (never at construction, the catalog is built in Node tests) and the
 * bundle is fetched on the first enable.
 * @param {object} context
 * @returns {object} Layer descriptor.
 */
export function createLifecycle({
  state,
  parts,
  source,
  cesium,
  overlayHost,
  createRendering,
}) {
  const notify = () => state._rowControlsListener?.();

  function abortLoad() {
    state._abort?.abort();
    state._abort = null;
    state._loading = false;
    state._loadingLabel = '';
  }

  function resetState() {
    state._viewer = null;
    state._enabled = false;
    state._loaded = false;
    state._records = null;
    state._authored = null;
    state._count = 0;
    state._summary = { total: 0, warm: 0, cold: 0, features: 0 };
    state._error = null;
    state._lastUpdate = null;
  }

  const reducedMotion = () =>
    parts.rendering?.getDiagnostics?.()?.reducedMotion === true;

  // A constant label with `active` as the pressed state, rather than a
  // Pause/Resume flip, so the toggle reads the same way to every user.
  function motionChip() {
    const paused = state._paused;
    return {
      id: 'motion',
      label: t('Pause'),
      active: paused,
      params: { paused: !paused },
      title: t('Pause the flow animation; the schematic does not change'),
    };
  }

  /** Keyboard-reachable info lines; provenance belongs here, not in a hover title. */
  function infoLines() {
    const lines = [
      t('Schematic · {count} major surface currents', {
        count: state._summary.total,
      }),
      t('Positions are drawn by hand after textbook maps, not measured flow.'),
    ];
    if (reducedMotion())
      lines.push(t('Animation paused by your reduced-motion setting.'));
    return lines.join('\n');
  }

  return {
    id: OCEAN_CURRENTS_LAYER_ID,
    name: 'Ocean currents',
    icon: '≈',
    source: source.label,
    updateInterval: 0,
    statsRefreshInterval: 1000,

    init(viewer) {
      state._viewer = viewer;
      if (!parts.rendering)
        parts.rendering = createRendering({
          cesium,
          getViewer: () => state._viewer,
          overlayHost,
          onStatusChange: notify,
        });
      parts.rendering.setOptions({ paused: state._paused });
    },

    enable(viewer) {
      state._enabled = true;
      parts.rendering?.start();
      void parts.ingestion.load(viewer || state._viewer);
    },

    disable() {
      state._enabled = false;
      abortLoad();
      parts.rendering?.stop();
      parts.rendering?.clear();
      // Records stay cached; the primitives are rebuilt from them on enable.
      state._loaded = false;
    },

    update(viewer) {
      return parts.ingestion.load(viewer || state._viewer);
    },

    destroy() {
      abortLoad();
      parts.rendering?.destroy();
      parts.rendering = null;
      resetState();
    },

    getStats() {
      return {
        count: state._count,
        lastUpdate: state._lastUpdate,
        loading: state._loading,
        loadingLabel: state._loadingLabel,
        error: state._error,
        warm: state._summary.warm,
        cold: state._summary.cold,
        paused: state._paused,
      };
    },

    // An open object: a later live-model chip adds `model` here without
    // changing the layer id or its share-link token.
    getParams() {
      return { paused: state._paused };
    },

    setParams(params = {}) {
      if (typeof params.paused === 'boolean') {
        state._paused = params.paused;
        parts.rendering?.setOptions({ paused: state._paused });
      }
      notify();
    },

    setRowControlsListener(listener) {
      state._rowControlsListener =
        typeof listener === 'function' ? listener : null;
    },

    getRowControls() {
      return {
        // Under reduced motion the animation is already still, so a disabled
        // chip would be noise; the info line says why instead.
        chips: reducedMotion() ? [] : [motionChip()],
        legend: [
          {
            label: t('Warm currents'),
            color: WARM_COLOR,
            count: state._summary.warm,
          },
          {
            label: t('Cold currents'),
            color: COLD_COLOR,
            count: state._summary.cold,
          },
        ],
        info: infoLines(),
        infoTitle: t(
          'A textbook map of the major surface currents. Lines are hand-drawn approximations lifted 12 km for visibility; the moving dashes show direction only, not speed. Not a forecast.',
        ),
      };
    },

    getDiagnostics() {
      return parts.rendering?.getDiagnostics?.() ?? {};
    },
  };
}
