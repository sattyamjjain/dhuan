import test from 'node:test';
import assert from 'node:assert/strict';
import { flyToAustin } from '../camera.js';

test('teardown before the initial camera delay prevents a late flight', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let flights = 0;
  let cancelled = 0;
  const stop = flyToAustin({
    isDestroyed: () => false,
    camera: {
      setView() {},
      flyTo() {
        flights++;
      },
      cancelFlight() {
        cancelled++;
      },
    },
  });
  stop();
  t.mock.timers.tick(1000);
  assert.equal(flights, 0);
  assert.equal(cancelled, 1);
});

test('the edition home view sets the approach pose, then flies to rest once', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { flyToHome } = await import('../camera.js');
  const { EDITION } = await import('../edition.js');
  const views = [];
  const flights = [];
  const stop = flyToHome(
    {
      isDestroyed: () => false,
      camera: {
        setView(view) {
          views.push(view);
        },
        flyTo(flight) {
          flights.push(flight);
        },
        cancelFlight() {},
      },
    },
    EDITION.home,
  );
  assert.equal(views.length, 1);
  assert.equal(flights.length, 0);
  t.mock.timers.tick(600);
  assert.equal(flights.length, 1);
  assert.equal(flights[0].duration, 4);
  stop();
});
