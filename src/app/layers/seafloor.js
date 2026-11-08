import * as Cesium from 'cesium';
import {
  clearSelectedEntityContextForLayer,
  registerEntityContext,
  removeEntityContextsForLayer,
  selectEntityContext,
} from '../../data/contextStore.js';
import { createSeafloorFeaturesLayer } from '../../layers/seafloor/index.js';
import { overlayHost } from './overlayHost.js';

/**
 * Wire the sea floor layer to the application: the overlay host, the shared
 * context store, the window's map-stack events, and the shell's basemap
 * request lane for the Sea floor map chip.
 */
export function createApplicationSeafloor(options = {}) {
  const hasWindow = typeof window !== 'undefined';
  return createSeafloorFeaturesLayer({
    overlayHost,
    screenSpaceEventHandlerFactory: (canvas) =>
      new Cesium.ScreenSpaceEventHandler(canvas),
    registerEntityContext,
    selectEntityContext,
    removeEntityContextsForLayer,
    clearSelectedEntityContextForLayer,
    mapStackEventTarget: hasWindow ? window : null,
    requestMapStack: hasWindow
      ? (id) =>
          window.dispatchEvent(
            new CustomEvent('gev:map-stack-request', { detail: { id } }),
          )
      : null,
    ...options,
  });
}
