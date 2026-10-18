import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseSceneDocument } from '../director/document.js';
import { getSceneRecipeById, SCENE_RECIPES } from './recipes.js';
import { createDefaultProject, recipeToScene } from './project.js';

const DOCUMENT_PATH = new URL('../../scenes/smog-season-live.json', import.meta.url);

test('the shipped scene document validates and matches the built-in recipe', () => {
  const project = parseSceneDocument(readFileSync(DOCUMENT_PATH, 'utf8'));
  assert.equal(project.version, 5);
  assert.equal(project.scenes.length, 1);
  const [scene] = project.scenes;
  assert.equal(scene.id, 'smog-season-live');
  assert.equal(scene.shots.length, 4);

  const recipe = getSceneRecipeById('smog-season-live');
  assert.ok(recipe, 'the recipe is registered');
  const built = recipeToScene(recipe);
  assert.deepEqual(
    scene.shots.map((shot) => shot.title),
    built.shots.map((shot) => shot.title),
  );
  for (const [index, shot] of scene.shots.entries()) {
    const expected = built.shots[index];
    assert.deepEqual(shot.camera, expected.camera, `shot ${index} camera`);
    assert.equal(shot.durationSec, expected.durationSec, `shot ${index} duration`);
    assert.equal(shot.holdSec, expected.holdSec, `shot ${index} hold`);
  }
  const total = scene.shots.reduce(
    (sum, shot) => sum + shot.durationSec + shot.holdSec,
    0,
  );
  assert.ok(total >= 14 && total <= 18, `a 15-second clip, got ${total}s`);
});

test('the scene plays fires and wind from the first shot and stations from the third', () => {
  const recipe = getSceneRecipeById('smog-season-live');
  const scene = recipeToScene(recipe);
  const enabled = (shot, id) => shot.layers[id]?.enabled === true;
  assert.equal(enabled(scene.shots[0], 'local-firms'), true);
  assert.equal(enabled(scene.shots[0], 'wind'), true);
  assert.equal(enabled(scene.shots[0], 'air-quality'), false);
  assert.equal(enabled(scene.shots[2], 'air-quality'), true);
  assert.equal(enabled(scene.shots[3], 'air-quality'), true);
  for (const shot of scene.shots) {
    for (const id of ['military', 'cctv', 'military-installations', 'alpr-cameras'])
      assert.equal(shot.layers[id], undefined, `${id} never appears`);
  }
});

test('a fresh project installs the scene first among the public recipes', () => {
  const project = createDefaultProject();
  assert.ok(project.scenes.some((scene) => scene.id === 'smog-season-live'));
  const ids = SCENE_RECIPES.map((recipe) => recipe.id);
  assert.ok(ids.indexOf('smog-season-live') < ids.indexOf('flights-radar'));
});
