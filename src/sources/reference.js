import { createUsgsEarthquakeSource } from '../layers/earthquakes/source.js';
import { createAirQualitySource } from '../layers/airQuality/source.js';
import { selectedAirQualityProviderId } from './airQualityProvider.js';
import { createWfigsPerimeterSource } from '../layers/perimeters/source.js';
import { createBundledCableSource } from '../layers/submarineCables/bundledSource.js';
import { createAdsbGnssSource } from '../layers/gnss/source.js';

/** Construct the existing reference feeds independently of application setup. */
export function createReferenceSources() {
  return {
    earthquakes: createUsgsEarthquakeSource(),
    'air-quality': createAirQualitySource({
      providerId: selectedAirQualityProviderId(),
    }),
    'fire-perimeters': createWfigsPerimeterSource(),
    cables: createBundledCableSource(),
    'gnss-integrity': createAdsbGnssSource(),
  };
}
