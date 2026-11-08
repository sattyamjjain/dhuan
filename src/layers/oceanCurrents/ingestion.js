import { msg, t } from '../../i18n/index.js';
import { normalizeCurrentFeatures, summarizeCurrents } from './model.js';

/**
 * Load the schematic once per session and hand the records to the renderer.
 * Ownership follows the cables pattern: a generation token plus an
 * AbortController, checked after every await, so a disable followed by a
 * fresh enable never lets the stale load touch shared state.
 * @param {{state: object, parts: object, source: object}} context
 * @returns {{load: function(object=): Promise<void>}}
 */
export function createIngestion({ state, parts, source }) {
  function commit(viewer) {
    const records = state._records;
    const built = parts.rendering?.setCurrents(records);
    state._count = records.length;
    state._summary = summarizeCurrents(records);
    state._lastUpdate = state._authored;
    state._loaded = true;
    // The vertex-shader patch is the one runtime dependency that can fail; a
    // Cesium upgrade that changes the polyline shader disables the layer
    // with a status line, not a blank globe.
    if (built === false)
      state._error = msg('Ocean currents need WebGL polylines');
    (viewer || state._viewer)?.scene?.requestRender?.();
  }

  async function load(viewer) {
    if (state._loading || state._loaded) return;
    state._loading = true;
    state._error = null;
    state._loadingLabel = t('loading...');
    const generation = ++state._loadGeneration;
    const abort = new AbortController();
    state._abort = abort;
    const owns = () =>
      generation === state._loadGeneration && !abort.signal.aborted;
    try {
      if (!state._records) {
        const json = await source.fetch(abort.signal);
        if (!owns()) return;
        state._records = normalizeCurrentFeatures(json);
        const authored = Date.parse(json?.meta?.authored);
        state._authored = Number.isFinite(authored) ? authored : null;
      }
      if (!owns()) return;
      commit(viewer);
    } catch (error) {
      // A stale or aborted load reports nothing: its failure belongs to a
      // lifecycle the user already left.
      if (owns() && error?.name !== 'AbortError') {
        state._error = msg('Ocean currents unavailable');
        console.warn('[Data:ocean-currents]', error?.message || error);
      }
    } finally {
      // Only the owning load may clear the shared lifecycle; a stale load
      // clearing it would hand a later enable a duplicate load.
      if (generation === state._loadGeneration) {
        state._loading = false;
        state._loadingLabel = '';
        if (state._abort === abort) state._abort = null;
      }
    }
  }

  return { load };
}
