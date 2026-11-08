import {
  COLD_COLOR,
  DISPLAY_HEIGHT_METERS,
  FADE_HIGH_METERS,
  FADE_LOW_METERS,
  GEODESIC_GRANULARITY_RAD,
  GHOST_ALPHA_PAUSED,
  GHOST_ALPHA_RUNNING,
  COLD_TAIL_FRACTION,
  WARM_TAIL_FRACTION,
  WARM_COLOR,
} from './policy.js';
import { currentLineWidth } from './model.js';

// Dashed flow in the wind sign convention, so dashes follow vertex order. The
// integer part of s identifies a current; `dash` folds its fraction so every
// current carries chevrons at one spacing and one km/s regardless of length.
const FLOW_MATERIAL = `
in float v_currentWarm;
in float v_currentDash;
in float v_currentRate;
in float v_currentFacing;
czm_material czm_getMaterial(czm_materialInput materialInput)
{
    czm_material material = czm_getDefaultMaterial(materialInput);
    float pathId = floor(materialInput.st.s);
    float along = fract(materialInput.st.s);
    float offset = fract((pathId + 1.0) * 0.61803398875);
    float behind = fract(phaseTime * v_currentRate + offset - along * v_currentDash);
    float tailLength = mix(${COLD_TAIL_FRACTION.toFixed(2)}, ${WARM_TAIL_FRACTION.toFixed(2)}, v_currentWarm);
    float tail = 1.0 - smoothstep(0.0, tailLength, behind);
    float tip = 1.0 - smoothstep(0.0, 0.06, behind);
    float ends = smoothstep(0.0, 0.03, along) * (1.0 - smoothstep(0.97, 1.0, along));
    float edge = 1.0 - smoothstep(0.3, 0.5, abs(materialInput.st.t - 0.5));
    float horizon = smoothstep(0.0, 0.065, v_currentFacing);
    vec3 base = mix(coldColor.rgb, warmColor.rgb, v_currentWarm);
    material.diffuse = mix(base, vec3(1.0), 0.55 * tip);
    material.alpha = (ghostAlpha + 0.6 * tail + 0.2 * tip) * ends * edge * horizon * heightFade;
    return material;
}`;

const SEED_ASSIGNMENT = /v_st\.s\s*=\s*st\.s\s*;/;
const MAIN_ENTRY = /void\s+main\s*\(\s*\)\s*\{/;

/**
 * Extend Cesium's public polyline vertex shader instead of duplicating its
 * expansion code: seed s with the batch id so the fragment stage can tell
 * currents apart, carry the per-instance attributes, and compute facing so
 * the far hemisphere masks itself when a scene hides the globe.
 */
function patchVertexShader(source) {
  if (!MAIN_ENTRY.test(source) || !SEED_ASSIGNMENT.test(source))
    throw new Error('Ocean current polyline shader entry unavailable');
  const seeded = source.replace(
    SEED_ASSIGNMENT,
    'v_st.s = st.s * 0.999 + czm_batchTable_currentSeed(batchId);',
  );
  const outputs =
    'out float v_currentWarm;\nout float v_currentDash;\nout float v_currentRate;\nout float v_currentFacing;\n';
  return `${outputs}${seeded}`.replace(
    MAIN_ENTRY,
    'void main() {\n' +
      'vec3 currentWorld = (czm_model * vec4(position3DHigh + position3DLow, 1.0)).xyz;\n' +
      'v_currentFacing = dot(normalize(currentWorld), normalize(czm_viewerPositionWC - currentWorld));\n' +
      'v_currentWarm = czm_batchTable_currentWarm(batchId);\n' +
      'v_currentDash = czm_batchTable_currentDash(batchId);\n' +
      'v_currentRate = czm_batchTable_currentRate(batchId);\n',
  );
}

function floatAttribute(C, value) {
  return new C.GeometryInstanceAttribute({
    componentDatatype: C.ComponentDatatype.FLOAT,
    componentsPerAttribute: 1,
    value: [value],
  });
}

function groupByBasin(records) {
  const groups = new Map();
  records.forEach((record, index) => {
    if (!groups.has(record.basin)) groups.set(record.basin, []);
    groups.get(record.basin).push({ record, seed: index });
  });
  return groups;
}

/** Native Cesium geometry/material owner. No animation loop or DOM ownership. */
export function createOceanCurrentGpuRendering({ cesium: C, getViewer }) {
  const cells = [];
  let occluder = null;
  let collection = null;
  let material = null;
  let paused = false;
  let destroyed = false;
  const emptyDiagnostics = () => ({
    primitiveCount: 0,
    visiblePrimitives: 0,
    currentCount: 0,
    vertexCount: 0,
    buildMs: 0,
    heightFade: 0,
    error: null,
  });
  let diagnostics = emptyDiagnostics();
  const ghostAlpha = () => (paused ? GHOST_ALPHA_PAUSED : GHOST_ALPHA_RUNNING);

  function supported() {
    const scene = getViewer?.()?.scene;
    return (
      !destroyed &&
      Boolean(
        scene?.primitives &&
        C?.Primitive &&
        C?.GeometryInstance &&
        C?.GeometryInstanceAttribute &&
        C?.ComponentDatatype?.FLOAT !== undefined &&
        C?.PolylineGeometry &&
        C?.PolylineMaterialAppearance &&
        C?.Material &&
        C?.Color?.fromCssColorString &&
        C?.ArcType?.GEODESIC !== undefined &&
        C?.BoundingSphere?.fromPoints &&
        C?.Occluder &&
        C?.Ellipsoid?.WGS84 &&
        C?.Intersect &&
        C?.Cartesian3?.fromDegrees,
      ) &&
      (C.SceneMode?.SCENE3D === undefined ||
        scene.mode === undefined ||
        scene.mode === C.SceneMode.SCENE3D)
    );
  }

  function clear() {
    for (const cell of cells) {
      collection?.remove(cell.primitive);
      if (!cell.primitive.isDestroyed?.()) cell.primitive.destroy?.();
    }
    cells.length = 0;
    occluder = null;
    collection = null;
    material?.destroy?.();
    material = null;
    diagnostics = emptyDiagnostics();
  }

  function createMaterial() {
    return new C.Material({
      fabric: {
        type: 'GevOceanCurrentFlow',
        uniforms: {
          phaseTime: 0,
          ghostAlpha: ghostAlpha(),
          heightFade: 0,
          warmColor: C.Color.fromCssColorString(WARM_COLOR),
          coldColor: C.Color.fromCssColorString(COLD_COLOR),
        },
        source: FLOW_MATERIAL,
      },
      translucent: () => true,
    });
  }

  function createInstance({ record, seed }) {
    const positions = record.coordinates.map(([lon, lat]) =>
      C.Cartesian3.fromDegrees(lon, lat, DISPLAY_HEIGHT_METERS),
    );
    // GEODESIC keeps the per-vertex lift while subdividing, so long chords do
    // not sag under the ellipsoid the way NONE would.
    const geometry = new C.PolylineGeometry({
      positions,
      width: currentLineWidth(record.temp),
      arcType: C.ArcType.GEODESIC,
      granularity: GEODESIC_GRANULARITY_RAD,
      vertexFormat: C.PolylineMaterialAppearance.VERTEX_FORMAT,
    });
    const instance = new C.GeometryInstance({
      geometry,
      attributes: {
        currentSeed: floatAttribute(C, seed),
        currentWarm: floatAttribute(C, record.temp === 'warm' ? 1 : 0),
        currentDash: floatAttribute(C, record.dashCount),
        currentRate: floatAttribute(C, record.rate),
      },
    });
    return { instance, positions };
  }

  function createCell(members, vertexShaderSource) {
    const cellPositions = [];
    let vertexCount = 0;
    const instances = members.map((member) => {
      const { instance, positions } = createInstance(member);
      cellPositions.push(...positions);
      vertexCount += positions.length * 4 - 4;
      return instance;
    });
    const appearance = new C.PolylineMaterialAppearance({
      material,
      vertexShaderSource,
      translucent: true,
      renderState: { depthTest: { enabled: true }, depthMask: false },
    });
    const primitive = new C.Primitive({
      show: false,
      geometryInstances: instances,
      appearance,
      asynchronous: true,
      allowPicking: false,
      releaseGeometryInstances: true,
      compressVertices: false,
    });
    return {
      primitive,
      sphere: C.BoundingSphere.fromPoints(cellPositions),
      vertexCount,
    };
  }

  function setCurrents(records) {
    clear();
    if (!supported() || !Array.isArray(records) || !records.length)
      return false;
    const started = globalThis.performance?.now?.() ?? Date.now();
    try {
      material = createMaterial();
      const vertexShaderSource = patchVertexShader(
        new C.PolylineMaterialAppearance({ material }).vertexShaderSource,
      );
      const scene = getViewer().scene;
      collection = scene.primitives;
      // EllipsoidalOccluder only tests points. Use Cesium's sphere occluder
      // with an inscribed Earth sphere, independent of scene.globe.show.
      occluder = new C.Occluder(
        new C.BoundingSphere(
          C.Cartesian3.ZERO,
          C.Ellipsoid.WGS84.minimumRadius,
        ),
        scene.camera.positionWC,
      );
      let vertexCount = 0;
      for (const members of groupByBasin(records).values()) {
        const cell = createCell(members, vertexShaderSource);
        cells.push(cell);
        collection.add(cell.primitive);
        vertexCount += cell.vertexCount;
      }
      diagnostics = {
        ...emptyDiagnostics(),
        primitiveCount: cells.length,
        currentCount: records.length,
        vertexCount,
        buildMs: (globalThis.performance?.now?.() ?? Date.now()) - started,
      };
      return true;
    } catch (error) {
      clear();
      diagnostics.error =
        // i18n-ignore: GPU diagnostics only; the panel never shows this field
        error instanceof Error
          ? error.message
          : 'Ocean current geometry unavailable';
      return false;
    }
  }

  function heightFadeFor(camera) {
    const height = camera.positionCartographic.height;
    return Math.max(
      0,
      Math.min(
        1,
        (height - FADE_LOW_METERS) / (FADE_HIGH_METERS - FADE_LOW_METERS),
      ),
    );
  }

  // Cesium reuses its frustum culling volume and the occluder's scratch
  // vectors; this loop allocates nothing per cell.
  function updateVisibility(camera) {
    const heightFade = heightFadeFor(camera);
    diagnostics.heightFade = heightFade;
    if (material) material.uniforms.heightFade = heightFade;
    diagnostics.visiblePrimitives = 0;
    let volume;
    if (heightFade > 0 && cells.length) {
      occluder.cameraPosition = camera.positionWC;
      volume = camera.frustum.computeCullingVolume(
        camera.positionWC,
        camera.directionWC,
        camera.upWC,
      );
    }
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      cell.primitive.show =
        heightFade > 0 &&
        occluder.isBoundingSphereVisible(cell.sphere) &&
        volume.computeVisibility(cell.sphere) !== C.Intersect.OUTSIDE;
      if (cell.primitive.show) diagnostics.visiblePrimitives++;
    }
    return diagnostics.visiblePrimitives > 0 && heightFade > 0;
  }

  return {
    supported,
    setCurrents,
    updateVisibility,
    tick(elapsedSeconds) {
      if (material && !paused && Number.isFinite(elapsedSeconds))
        material.uniforms.phaseTime = Math.max(0, elapsedSeconds) % 10000;
    },
    setOptions(options = {}) {
      if (typeof options.paused === 'boolean') paused = options.paused;
      if (material) material.uniforms.ghostAlpha = ghostAlpha();
    },
    clear,
    destroy() {
      clear();
      destroyed = true;
    },
    getDiagnostics: () => ({
      ...diagnostics,
      ready: cells.length > 0 && cells.every((cell) => cell.primitive.ready),
      displayHeightMeters: DISPLAY_HEIGHT_METERS,
    }),
  };
}
