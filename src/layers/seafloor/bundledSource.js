// Both bundles are redistributable with attribution: the GEBCO Gazetteer asks
// for the citation "IHO-IOC GEBCO Gazetteer of Undersea Feature Names,
// www.gebco.net", and PB2002 via fraxen/tectonicplates is ODC-By 1.0
// (credit Peter Bird 2003; Hugo Ahlenius, Nordpil). See each bundle's
// README.md and DATA_SOURCES.md.
import { loadBundledJson } from '../../data/bundledJson.js';

// Resolved when read, so importing this module never needs a module URL.
function featuresUrl() {
  return new URL(
    '../../data/local_data/gebco_gazetteer/seafloor-features.json',
    import.meta.url,
  );
}

function platesUrl() {
  return new URL(
    '../../data/local_data/pb2002_plate_boundaries/plate-boundaries.json',
    import.meta.url,
  );
}

/**
 * Supply the two bundles without coupling the renderer to asset URLs.
 * @param {object} [options]
 * @param {function(URL, {signal?: AbortSignal}): Promise<any>} [options.loadJson]
 *   Test seam; defaults to the shared bundled-JSON loader (fetch in the
 *   browser, a disk read under Node).
 * @returns {{label:string, fetch:function(AbortSignal=):Promise<{features:object,plates:object}>}}
 */
export function createBundledSeafloorSource({
  loadJson = loadBundledJson,
} = {}) {
  return {
    label: 'GEBCO Gazetteer', // i18n-ignore: data provider name
    async fetch(signal) {
      signal?.throwIfAborted();
      const [features, plates] = await Promise.all([
        loadJson(featuresUrl(), { signal }),
        loadJson(platesUrl(), { signal }),
      ]);
      // A cancellation that lands during the parse must not hand a stale
      // enable a snapshot it no longer owns.
      signal?.throwIfAborted();
      return { features, plates };
    },
  };
}
