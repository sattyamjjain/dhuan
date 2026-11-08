/**
 * Mutable layer state shared by ingestion, rendering and the lifecycle.
 * @param {{overlayHost: object}} options
 * @returns {object}
 */
export function createState({ overlayHost }) {
  const state = {};

  state._viewer = null;

  state._enabled = false;

  state._loading = false;

  state._loaded = false;

  /** Monotonic load-ownership token; every load() start claims a new one. */
  state._loadGeneration = 0;

  state._abort = null;

  /**
   * Normalised records kept across disable/enable. A disable releases the
   * GPU primitives, so a re-enable rebuilds them, but the parse and
   * validation of the bundle happen once per session.
   */
  state._records = null;

  /** Authoring date from the bundle's meta, surfaced as lastUpdate. */
  state._authored = null;

  state._count = 0;

  state._summary = { total: 0, warm: 0, cold: 0, features: 0 };

  state._error = null;

  state._lastUpdate = null;

  state._loadingLabel = '';

  state._paused = false;

  state._rowControlsListener = null;

  state._overlayHost = overlayHost;

  return state;
}
