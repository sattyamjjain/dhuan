import { loadBundledJson } from '../../data/bundledJson.js';
import { msg } from '../../i18n/marker.js';

// Resolved when read, so importing this module never needs a module URL and
// Vite still sees the literal path it emits as an asset.
function currentsUrl() {
  return new URL(
    '../../data/local_data/ocean_currents/currents.json',
    import.meta.url,
  );
}

/**
 * Supply the hand-drawn schematic without coupling the layer to its asset
 * URL. `loadJson` is the test seam and the later live-model seam.
 * @param {{loadJson?: function(URL, {signal?: AbortSignal}): Promise<object>}} [options]
 * @returns {{label: string, fetch: function(AbortSignal=): Promise<object>}}
 */
export function createBundledCurrentSource({
  loadJson = loadBundledJson,
} = {}) {
  return {
    label: msg('Hand-drawn schematic'),
    async fetch(signal) {
      signal?.throwIfAborted();
      const json = await loadJson(currentsUrl(), { signal });
      signal?.throwIfAborted();
      return json;
    },
  };
}
