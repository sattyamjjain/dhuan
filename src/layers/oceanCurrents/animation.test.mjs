import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlowClock } from './animation.js';

function harness(options = {}) {
  let time = 0;
  let nextHandle = 1;
  const queue = [];
  const cancelled = [];
  const frames = [];
  const state = { canRun: true };
  const clock = createFlowClock({
    now: () => time,
    requestFrame: (callback) => {
      const handle = nextHandle++;
      queue.push({ handle, callback });
      return handle;
    },
    cancelFrame: (handle) => {
      cancelled.push(handle);
      const index = queue.findIndex((item) => item.handle === handle);
      if (index >= 0) queue.splice(index, 1);
    },
    canRun: () => state.canRun,
    onFrame: (flowTime) => frames.push(flowTime),
    ...options,
  });
  /** Advance the fake clock and run the one pending frame, if any. */
  const step = (ms) => {
    time += ms;
    queue.shift()?.callback();
  };
  return { clock, queue, cancelled, frames, state, step };
}

test('frames are capped at 30 Hz while flow time keeps real elapsed time', () => {
  const h = harness();
  h.clock.start();
  assert.equal(h.queue.length, 1, 'start schedules one frame');
  h.step(0);
  assert.equal(h.frames.length, 1, 'the first frame paints at once');
  assert.ok(Math.abs(h.frames[0] - 1 / 60) < 1e-9);
  h.step(10);
  h.step(10);
  assert.equal(h.frames.length, 1, 'frames 10 and 20 ms later are skipped');
  h.step(20);
  assert.equal(h.frames.length, 2, '40 ms after the last paint passes the cap');
  assert.ok(Math.abs(h.frames[1] - (1 / 60 + 0.04)) < 1e-9);
  assert.equal(h.queue.length, 1, 'the loop keeps one frame pending');
  assert.equal(h.clock.isPending(), true);
  assert.equal(h.clock.isRunning(), true);
  assert.ok(Math.abs(h.clock.getFlowTime() - h.frames[1]) < 1e-9);
  h.clock.stop();
});

test('no frame is scheduled while canRun() is false; poke() schedules at most one', () => {
  const h = harness();
  h.state.canRun = false;
  h.clock.start();
  assert.equal(h.queue.length, 0);
  h.clock.poke();
  h.clock.poke();
  assert.equal(h.queue.length, 0);
  h.state.canRun = true;
  h.clock.poke();
  h.clock.poke();
  assert.equal(h.queue.length, 1, 'repeated pokes share one pending frame');
  h.step(5);
  assert.equal(h.frames.length, 1);
  h.clock.stop();
});

test('stop() cancels the pending frame and a stopped clock ignores pokes', () => {
  const h = harness();
  h.clock.start();
  const pending = h.queue[0].handle;
  h.clock.stop();
  assert.deepEqual(h.cancelled, [pending]);
  assert.equal(h.queue.length, 0);
  assert.equal(h.clock.isRunning(), false);
  assert.equal(h.clock.isPending(), false);
  h.clock.poke();
  assert.equal(h.queue.length, 0);
  h.clock.stop();
  assert.equal(h.cancelled.length, 1, 'a second stop cancels nothing');
});

test('a frame that finds canRun() false ends the loop; poke() drops a pending frame', () => {
  const h = harness();
  h.clock.start();
  h.step(0);
  assert.equal(h.frames.length, 1);
  h.state.canRun = false;
  h.step(40);
  assert.equal(h.frames.length, 1, 'no paint while motion is unwanted');
  assert.equal(h.queue.length, 0, 'and no frame is rescheduled');
  h.state.canRun = true;
  h.clock.poke();
  assert.equal(h.queue.length, 1);
  h.state.canRun = false;
  h.clock.poke();
  assert.equal(
    h.queue.length,
    0,
    'poke cancels a frame that can no longer run',
  );
  assert.equal(h.cancelled.length, 1);
  h.state.canRun = true;
  h.clock.poke();
  h.step(1000);
  assert.equal(h.frames.length, 2);
  assert.ok(
    Math.abs(h.frames[1] - h.frames[0] - 1 / 60) < 1e-9,
    'after an idle gap the clock resumes with a nominal frame, not the gap',
  );
  h.clock.stop();
});

test('reset() rewinds flow time without touching the schedule', () => {
  const h = harness();
  h.clock.start();
  h.step(0);
  h.step(100);
  assert.ok(h.clock.getFlowTime() > 0.1);
  h.clock.reset();
  assert.equal(h.clock.getFlowTime(), 0);
  assert.equal(h.clock.isRunning(), true);
  assert.equal(h.queue.length, 1);
  h.clock.stop();
});

test('start() is idempotent and the default clock sources exist', () => {
  const h = harness();
  h.clock.start();
  h.clock.start();
  assert.equal(h.queue.length, 1);
  h.clock.stop();
  const bare = createFlowClock({ onFrame() {} });
  assert.equal(bare.isRunning(), false);
  assert.equal(bare.getFlowTime(), 0);
});
