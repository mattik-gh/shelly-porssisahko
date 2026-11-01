/**
 * Käyttäjäskriptien rajapinnan (USER_CONFIG, USER_OVERRIDE, USER_LOOP) testit.
 *
 * Mukana tulevien lisäosien (src/after-build/) testit ovat hakemistossa test/addons/,
 * yksi tiedosto per lisäosa: lisäosa yksin ja lisäosa pääskriptin kanssa.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { boot, assertAlive, runDay, hours, DAY_BEFORE, DAY } = require('./helpers');

describe('käyttäjäskriptien rajapinta', () => {
  test('USER_OVERRIDE voi muuttaa ohjausta (tilakoodi 12)', () => {
    const sim = boot({
      inst: { mode: 0, m0: { c: 0 } },
      user: 'function USER_OVERRIDE(inst, cmd, callback) { callback(inst == 0 ? true : cmd); }'
    });

    assert.equal(sim.relays[0], true);
    assert.equal(sim.status(0).si.st, 12);
  });

  test('USER_OVERRIDE saa alkuperäisen ohjauksen parametrina', () => {
    const sim = boot({
      inst: { mode: 0, m0: { c: 1 } },
      user: 'let seen = []; function USER_OVERRIDE(inst, cmd, callback) { seen.push([inst, cmd]); callback(cmd); }'
    });

    assert.deepEqual(sim.evaluate('seen'), [[0, true]]);
    assert.equal(sim.relays[0], true);
    assert.equal(sim.status(0).si.st, 1, 'tilakoodi ei muutu jos ohjaus ei muutu');
  });

  test('USER_OVERRIDE callback(null) ajaa logiikan uudelleen', () => {
    const sim = boot({
      inst: { mode: 0, m0: { c: 1 } },
      user: 'let calls = 0; function USER_OVERRIDE(inst, cmd, callback) { calls++; callback(calls < 3 ? null : cmd); }'
    });
    sim.settle(60000);

    assert.equal(sim.evaluate('calls'), 3);
    assert.equal(sim.relays[0], true);
  });

  test('USER_OVERRIDE voi vastata viiveellä', () => {
    const sim = boot({
      inst: { mode: 0, m0: { c: 1 } },
      user: 'function USER_OVERRIDE(inst, cmd, callback) { Timer.set(2000, false, function () { callback(false); }); }'
    });

    assert.equal(sim.relays[0], false);
    assert.equal(sim.status(0).si.st, 12);
  });

  test('USER_CONFIG kutsutaan asetuksia ladattaessa ja ennen logiikkaa', () => {
    const sim = boot({
      inst: { mode: 0, m0: { c: 1 } },
      user: 'let cfgCalls = []; function USER_CONFIG(inst, initialized) { cfgCalls.push([inst, initialized]); }'
    });

    assert.deepEqual(sim.evaluate('cfgCalls'), [[-1, true], [0, true], [1, true], [2, true], [0, false]]);
  });

  test('USER_CONFIG voi muuttaa asetuksia lennossa', () => {
    const sim = boot({
      inst: { mode: 0, m0: { c: 0 } },
      user: 'function USER_CONFIG(inst, initialized) { if (inst == 0) { _.c.i[0].m0.c = 1; } }'
    });

    assert.equal(sim.relays[0], true);
  });

  test('USER_LOOP kutsutaan kun muuta tehtävää ei ole', () => {
    const sim = boot({
      inst: { mode: 0, m0: { c: 1 } },
      user: 'let loops = 0; function USER_LOOP() { loops++; loopRunning = false; }'
    });
    sim.advance(60000);

    assert.ok(sim.evaluate('loops') >= 5);
    assert.equal(sim.request('r=s&i=0').code, 200);
  });
});
