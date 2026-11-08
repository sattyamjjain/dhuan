import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoundingSphere,
  Cartesian3,
  Color,
  Ellipsoid,
  Intersect,
  Occluder,
  PerspectiveFrustum,
} from 'cesium';
import { createOceanCurrentGpuRendering } from './gpuRendering.js';
import { normalizeCurrentFeatures } from './model.js';
import {
  DISPLAY_HEIGHT_METERS,
  FADE_HIGH_METERS,
  FADE_LOW_METERS,
  GEODESIC_GRANULARITY_RAD,
  GHOST_ALPHA_PAUSED,
  GHOST_ALPHA_RUNNING,
  COLD_LINE_WIDTH_PX,
  WARM_LINE_WIDTH_PX,
} from './policy.js';

function harness() {
  const members = new Set();
  const spheres = [];
  const visibility = {
    horizon: () => true,
    frustum: () => Intersect.INSIDE,
    horizonTests: 0,
    frustumTests: 0,
  };
  let occluderBuilds = 0;
  class Material {
    constructor(options) {
      this.uniforms = options.fabric.uniforms;
      this.source = options.fabric.source;
      this.type = options.fabric.type;
    }
    destroy() {
      assert.ok(!this.destroyed, 'owned resource destroyed once');
      this.destroyed = true;
    }
  }
  class Appearance {
    static VERTEX_FORMAT = {};
    constructor(options) {
      Object.assign(this, options);
      this.vertexShaderSource ??=
        'in vec3 position3DHigh; in vec3 position3DLow; void main() { gl_Position = vec4(0.0); v_st.s = st.s; }';
    }
  }
  class Polyline {
    constructor(options) {
      Object.assign(this, options);
    }
  }
  class Primitive {
    constructor(options) {
      Object.assign(this, options);
      this.ready = true;
    }
    destroy() {
      assert.ok(!this.destroyed, 'owned resource destroyed once');
      this.destroyed = true;
    }
    isDestroyed() {
      return Boolean(this.destroyed);
    }
  }
  const C = {
    ComponentDatatype: { FLOAT: 5126 },
    GeometryInstanceAttribute: class {
      constructor(options) {
        Object.assign(this, options);
      }
    },
    Material,
    PolylineMaterialAppearance: Appearance,
    PolylineGeometry: Polyline,
    Primitive,
    GeometryInstance: class {
      constructor(options) {
        Object.assign(this, options);
      }
    },
    Cartesian3,
    Color,
    Ellipsoid,
    Intersect,
    BoundingSphere: class extends BoundingSphere {
      static fromPoints(points) {
        const sphere = BoundingSphere.fromPoints(points);
        spheres.push({ sphere, points });
        return sphere;
      }
    },
    Occluder: class {
      constructor(_sphere, cameraPosition) {
        occluderBuilds++;
        this.cameraPosition = cameraPosition;
      }
      isBoundingSphereVisible(sphere) {
        visibility.horizonTests++;
        return visibility.horizon(sphere, this.cameraPosition);
      }
    },
    ArcType: { NONE: 0, GEODESIC: 1, RHUMB: 2 },
  };
  const volume = {
    computeVisibility(sphere) {
      visibility.frustumTests++;
      return visibility.frustum(sphere);
    },
  };
  const scene = {
    globe: { show: false },
    camera: {
      positionWC: Cartesian3.fromDegrees(-40, 30, 1e7),
      positionCartographic: { height: 1e7 },
      directionWC: new Cartesian3(-1, 0, 0),
      upWC: new Cartesian3(0, 0, 1),
      frustum: { computeCullingVolume: () => volume },
    },
    primitives: {
      add(item) {
        members.add(item);
      },
      remove(item) {
        const removed = members.delete(item);
        if (removed) item.destroy();
        return removed;
      },
    },
  };
  return {
    C,
    scene,
    members,
    spheres,
    visibility,
    occluderBuilds: () => occluderBuilds,
    owner: createOceanCurrentGpuRendering({
      cesium: C,
      getViewer: () => ({ scene }),
    }),
  };
}

const line = (id, temp, basin, coordinates, extra = {}) => ({
  type: 'Feature',
  id,
  properties: { name: id, temp, basin, ...extra },
  geometry: { type: 'LineString', coordinates },
});
const records = () =>
  normalizeCurrentFeatures({
    features: [
      line(
        'a-warm',
        'warm',
        'atlantic',
        [
          [-80, 25],
          [-75, 35],
          [-65, 39],
          [-50, 43],
        ],
        { speedClass: 'fast', rank: 1 },
      ),
      line('a-cold', 'cold', 'atlantic', [
        [-10, 42],
        [-13, 36],
        [-16, 30],
        [-20, 17],
      ]),
      line('p-wrap', 'warm', 'pacific', [
        [150, 38],
        [170, 41],
        [190, 43],
        [224, 46],
      ]),
      line(
        's-ring',
        'cold',
        'southern',
        [
          [-65, -58],
          [-40, -56],
          [-10, -54],
          [20, -54],
        ],
        { speedClass: 'slow' },
      ),
      // Compact and antipodal to the harness camera, so a real occluder can
      // hide it while the wide Pacific sphere above stays conservative.
      line('i-far', 'cold', 'indian', [
        [138, -28],
        [140, -30],
        [142, -32],
        [144, -34],
      ]),
    ],
  });

test('one lifted geodesic primitive per basin with per-instance flow attributes', () => {
  const h = harness();
  assert.equal(h.owner.setCurrents(records()), true);
  assert.equal(h.members.size, 4, 'atlantic, pacific, southern, indian');
  const cells = [...h.members];
  const material = cells[0].appearance.material;
  assert.equal(material.type, 'GevOceanCurrentFlow');
  assert.ok(material.uniforms.warmColor instanceof Color);
  assert.ok(material.uniforms.coldColor instanceof Color);
  assert.equal(material.uniforms.heightFade, 0);
  assert.equal(material.uniforms.ghostAlpha, GHOST_ALPHA_RUNNING);
  assert.match(
    material.source,
    /mix\(coldColor\.rgb, warmColor\.rgb, v_currentWarm\)/,
  );
  assert.match(material.source, /horizon \* heightFade/);
  assert.match(
    material.source,
    /mix\(0\.25, 0\.45, v_currentWarm\)/,
    'cold dashes carry a shorter tail than warm ones',
  );
  for (const cell of cells) {
    assert.equal(cell.allowPicking, false);
    assert.equal(cell.asynchronous, true);
    assert.equal(cell.releaseGeometryInstances, true);
    assert.equal(cell.show, false, 'hidden until updateVisibility');
    assert.equal(cell.appearance.material, material);
    const shader = cell.appearance.vertexShaderSource;
    assert.ok(shader.includes('czm_batchTable_currentSeed(batchId)'));
    assert.ok(shader.includes('out float v_currentWarm;'));
    assert.ok(
      shader.includes('v_currentDash = czm_batchTable_currentDash(batchId);'),
    );
    assert.ok(
      shader.includes('v_currentRate = czm_batchTable_currentRate(batchId);'),
    );
    assert.ok(shader.includes('v_currentFacing = dot('));
    assert.ok(!shader.includes('v_st.s = st.s;'));
  }
  const instances = cells.flatMap((cell) => cell.geometryInstances);
  assert.equal(instances.length, 5);
  const bySeed = new Map(
    instances.map((i) => [i.attributes.currentSeed.value[0], i]),
  );
  const expected = records();
  for (let seed = 0; seed < expected.length; seed++) {
    const instance = bySeed.get(seed);
    const record = expected[seed];
    assert.ok(instance, `seed ${seed}`);
    assert.equal(
      instance.attributes.currentWarm.value[0],
      record.temp === 'warm' ? 1 : 0,
    );
    assert.equal(instance.attributes.currentDash.value[0], record.dashCount);
    assert.equal(instance.attributes.currentRate.value[0], record.rate);
    assert.ok(instance.geometry instanceof h.C.PolylineGeometry);
    assert.equal(
      instance.geometry.width,
      record.temp === 'warm' ? WARM_LINE_WIDTH_PX : COLD_LINE_WIDTH_PX,
    );
    assert.equal(instance.geometry.arcType, h.C.ArcType.GEODESIC);
    assert.equal(instance.geometry.granularity, GEODESIC_GRANULARITY_RAD);
    assert.deepEqual(
      instance.geometry.positions,
      record.coordinates.map(([lon, lat]) =>
        Cartesian3.fromDegrees(lon, lat, DISPLAY_HEIGHT_METERS),
      ),
    );
  }
  for (const { sphere, points } of h.spheres)
    for (const point of points)
      assert.ok(
        Cartesian3.distance(point, sphere.center) <= sphere.radius + 1e-6,
      );
  const diagnostics = h.owner.getDiagnostics();
  assert.equal(diagnostics.primitiveCount, 4);
  assert.equal(diagnostics.currentCount, 5);
  assert.ok(diagnostics.vertexCount > 0);
  assert.equal(diagnostics.ready, true);
  assert.equal(diagnostics.error, null);
  assert.equal(diagnostics.displayHeightMeters, DISPLAY_HEIGHT_METERS);
});

test('tick advances the phase only while running; pause brightens the ghost', () => {
  const h = harness();
  h.owner.setCurrents(records());
  const material = [...h.members][0].appearance.material;
  h.owner.tick(3);
  assert.equal(material.uniforms.phaseTime, 3);
  h.owner.setOptions({ paused: true });
  assert.equal(material.uniforms.ghostAlpha, GHOST_ALPHA_PAUSED);
  h.owner.tick(8);
  assert.equal(material.uniforms.phaseTime, 3);
  h.owner.setOptions({ paused: false });
  assert.equal(material.uniforms.ghostAlpha, GHOST_ALPHA_RUNNING);
  h.owner.tick(9);
  assert.equal(material.uniforms.phaseTime, 9);
  h.owner.tick(10009);
  assert.equal(material.uniforms.phaseTime, 9, 'phase wraps at 10000 s');
  h.owner.tick(NaN);
  assert.equal(material.uniforms.phaseTime, 9);
});

test('a polyline shader without the seed line refuses the layer with a diagnostic', () => {
  const h = harness();
  h.C.PolylineMaterialAppearance = class extends (
    h.C.PolylineMaterialAppearance
  ) {
    constructor(options) {
      super({
        vertexShaderSource: 'void main() { gl_Position = vec4(0.0); }',
        ...options,
      });
    }
  };
  h.C.PolylineMaterialAppearance.VERTEX_FORMAT = {};
  assert.equal(h.owner.setCurrents(records()), false);
  assert.equal(h.members.size, 0);
  assert.match(h.owner.getDiagnostics().error, /shader entry unavailable/);
  assert.equal(h.owner.getDiagnostics().ready, false);
});

test('visibility hides everything below the fade floor and shares the fade uniform', () => {
  const h = harness();
  h.owner.setCurrents(records());
  const cells = [...h.members];
  const camera = h.scene.camera;
  assert.equal(h.owner.updateVisibility(camera), true);
  assert.equal(h.owner.getDiagnostics().visiblePrimitives, 4);
  assert.ok(cells.every((cell) => cell.show));
  for (const [height, fade] of [
    [FADE_HIGH_METERS, 1],
    [(FADE_HIGH_METERS + FADE_LOW_METERS) / 2, 0.5],
    [FADE_LOW_METERS, 0],
    [50_000, 0],
  ]) {
    camera.positionCartographic.height = height;
    assert.equal(h.owner.updateVisibility(camera), fade > 0);
    assert.equal(h.owner.getDiagnostics().heightFade, fade);
    for (const cell of cells) {
      assert.equal(cell.appearance.material.uniforms.heightFade, fade);
      if (!fade) assert.equal(cell.show, false);
    }
  }
  assert.equal(h.owner.getDiagnostics().visiblePrimitives, 0);
  const horizonTests = h.visibility.horizonTests;
  camera.positionCartographic.height = 1e7;
  h.visibility.horizon = (sphere) => sphere === h.spheres[0].sphere;
  assert.equal(h.owner.updateVisibility(camera), true);
  assert.equal(h.owner.getDiagnostics().visiblePrimitives, 1);
  assert.equal(h.visibility.horizonTests, horizonTests + 4);
  h.visibility.horizon = () => true;
  h.visibility.frustum = () => Intersect.OUTSIDE;
  assert.equal(h.owner.updateVisibility(camera), false);
  assert.equal(
    h.occluderBuilds(),
    1,
    'occluder is reused across camera updates',
  );
});

test('real Cesium sphere culling hides the far hemisphere and a sky-facing view', () => {
  const h = harness();
  h.C.Occluder = Occluder;
  h.owner.setCurrents(records());
  const camera = h.scene.camera;
  camera.frustum = new PerspectiveFrustum({
    fov: Math.PI / 3,
    aspectRatio: 1.5,
    near: 1,
    far: 5e7,
  });
  assert.equal(h.owner.updateVisibility(camera), true);
  const cells = [...h.members];
  const atlantic = cells[0];
  const antipodal = cells[3];
  assert.equal(
    atlantic.show,
    true,
    'camera over the Atlantic sees the Atlantic',
  );
  assert.equal(antipodal.show, false, 'the far side is beyond the horizon');
  camera.directionWC = Cartesian3.normalize(
    camera.positionWC,
    new Cartesian3(),
  );
  assert.equal(h.owner.updateVisibility(camera), false);
  h.owner.destroy();
});

test('replacement, clear and destroy dispose every owned cell and the shared material', () => {
  const h = harness();
  const assertDisposed = (cells) => {
    assert.equal(cells.length, 4);
    for (const cell of cells) {
      assert.equal(cell.destroyed, true);
      assert.equal(cell.appearance.material.destroyed, true);
    }
  };
  h.owner.setCurrents(records());
  const first = [...h.members];
  h.owner.setCurrents(records());
  assertDisposed(first);
  const second = [...h.members];
  h.owner.clear();
  assertDisposed(second);
  assert.equal(h.members.size, 0);
  assert.equal(h.owner.getDiagnostics().primitiveCount, 0);
  assert.equal(h.owner.getDiagnostics().ready, false);
  h.owner.setCurrents(records());
  const third = [...h.members];
  h.owner.destroy();
  assertDisposed(third);
  assert.equal(h.owner.supported(), false);
  assert.equal(h.owner.setCurrents(records()), false);
});

test('unsupported namespaces, 2D scenes and empty sets refuse cleanly', () => {
  const missing = createOceanCurrentGpuRendering({
    cesium: {},
    getViewer: () => ({ scene: {} }),
  });
  assert.equal(missing.supported(), false);
  assert.equal(missing.setCurrents(records()), false);
  const h = harness();
  h.C.SceneMode = { SCENE3D: 3, SCENE2D: 2 };
  h.scene.mode = 2;
  assert.equal(h.owner.supported(), false);
  h.scene.mode = 3;
  assert.equal(h.owner.supported(), true);
  assert.equal(h.owner.setCurrents([]), false);
  assert.equal(h.owner.setCurrents(null), false);
  const failing = harness();
  failing.C.PolylineGeometry = class {
    constructor() {
      throw new Error('test build failure');
    }
  };
  assert.equal(failing.owner.setCurrents(records()), false);
  assert.equal(failing.members.size, 0);
  assert.match(failing.owner.getDiagnostics().error, /test build failure/);
});

test('a failed later cell build releases already installed cells and the material', () => {
  const h = harness();
  const NativePrimitive = h.C.Primitive;
  const built = [];
  h.C.Primitive = class extends NativePrimitive {
    constructor(options) {
      if (built.length === 1) throw new Error('later cell failed');
      super(options);
      built.push(this);
    }
  };
  assert.equal(h.owner.setCurrents(records()), false);
  assert.equal(h.members.size, 0);
  assert.equal(built.length, 1);
  assert.equal(built[0].destroyed, true);
  assert.equal(built[0].appearance.material.destroyed, true);
  assert.match(h.owner.getDiagnostics().error, /later cell failed/);
});
