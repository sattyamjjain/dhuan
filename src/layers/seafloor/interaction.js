import * as Cesium from 'cesium';
import { isPointerFree } from '../../data/inputOwnership.js';

/**
 * Click handling: a left click on an anchor or a ground line selects the
 * feature's registered context (the shared card shows name and type). There
 * is deliberately no camera flight: a trench is 2,500 km long and flying to
 * its anchor would be wrong.
 */
export function createInteraction({
  state,
  screenSpaceEventHandlerFactory,
  selectEntityContext,
}) {
  function registerPickEntity(entity, record) {
    if (!entity) return;
    entity.__gevSeafloor = record;
    state._pickByEntity.set(entity, record);
  }

  function resolvePickRecord(picked) {
    if (!picked) return null;
    for (const carrier of [picked.id, picked.primitive, picked.primitive?.id]) {
      if (!carrier || typeof carrier !== 'object') continue;
      const record = state._pickByEntity.get(carrier) || carrier.__gevSeafloor;
      if (record) return record;
    }
    return null;
  }

  function beginInteraction(viewer) {
    if (
      state._clickHandler ||
      typeof screenSpaceEventHandlerFactory !== 'function'
    )
      return;
    state._clickHandler = screenSpaceEventHandlerFactory(viewer.scene.canvas);
    state._clickHandler.setInputAction((click) => {
      // A tool owns the pointer (src/data/inputOwnership.js): yield the click.
      if (!isPointerFree()) return;
      if (!state._enabled) return;
      const record = resolvePickRecord(viewer.scene.pick(click.position));
      if (!record?.entity) return;
      selectEntityContext?.(record.entity);
      viewer.scene.requestRender?.();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  return { registerPickEntity, resolvePickRecord, beginInteraction };
}
