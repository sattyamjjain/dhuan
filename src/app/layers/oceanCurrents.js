import { createOceanCurrentsLayer } from '../../layers/oceanCurrents/index.js';
import { overlayHost } from './overlayHost.js';

/** Wire the schematic currents to the application overlay host. */
export function createApplicationOceanCurrents(options) {
  return createOceanCurrentsLayer({ overlayHost, ...options });
}
