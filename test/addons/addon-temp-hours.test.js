/**
 * Lisäosa shelly-porssisahko-addon-temp-hours.js: halvimpien tuntien määrä ja ohjausminuutit Add-on-anturin lämpötilan mukaan
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { boot, runDay, hours, DAY_BEFORE, DAY } = require('../helpers');
const { loadAddon } = require('../sim/addon-alone');

const script = 'shelly-porssisahko-addon-temp-hours.js';

describe(`${script}: yksin`, () => {
  const sensor = (tC) => ({ 'temperature:100': { tC } });
  /** Lisäosa, jolle pääskripti on lukenut asetukset: 2 tuntia, 60 minuuttia */
  const load = (temp) => {
    const addon = loadAddon(script, { components: temp === undefined ? {} : sensor(temp), config: [{ m2: { c: 2 }, m: 60 }] });
    addon.config(0, true);
    return addon;
  };

  test('lisäosa käyttää vain USER_CONFIG-rajapintaa', () => {
    const addon = loadAddon(script);
    assert.equal(addon.has('USER_CONFIG'), true);
    assert.equal(addon.has('USER_OVERRIDE'), false);
  });

  const cases = [
    //[lämpötila, tunnit, minuutit]
    [10, 2, 60], [0, 2, 60], [-4.9, 2, 60],
    [-5, 6, 45], [-9.9, 6, 45],
    [-10, 7, 45], [-14.9, 7, 45],
    [-15, 8, 60], [-30, 8, 60]
  ];

  for (const [temp, h, m] of cases) {
    test(`${temp} °C -> ${h} tuntia, ${m} minuuttia`, () => {
      const addon = load(temp);
      const cfg = addon.config(0, false);
      assert.equal(cfg.m2.c, h);
      assert.equal(cfg.m, m);
      assert.match(addon.state.si[0].str, new RegExp(`halvat tunnit: ${h} h, ohjaus: ${m} min`));
    });
  }

  test('sään lauhtuessa palataan käyttäjän asettamiin arvoihin', () => {
    const addon = load(-20);
    assert.equal(addon.config(0, false).m2.c, 8);

    addon.components['temperature:100'].tC = 3;
    const cfg = addon.config(0, false);
    assert.equal(cfg.m2.c, 2);
    assert.equal(cfg.m, 60);
  });

  test('käyttöliittymästä tallennetut uudet arvot otetaan pohjaksi', () => {
    const addon = load(-20);
    addon.config(0, false);

    //Pääskripti lukee tallennetut asetukset uudelleen
    addon.state.c.i[0].m2.c = 5;
    addon.state.c.i[0].m = 30;
    addon.config(0, true);
    assert.equal(addon.value('originalConfig.hours'), 5);

    addon.components['temperature:100'].tC = 3;
    const cfg = addon.config(0, false);
    assert.equal(cfg.m2.c, 5);
    assert.equal(cfg.m, 30);
  });

  test('anturi puuttuu: käyttäjän arvot ja virheteksti', () => {
    const addon = load(undefined);
    const cfg = addon.config(0, false);
    assert.equal(cfg.m2.c, 2);
    assert.equal(cfg.m, 60);
    assert.match(addon.state.si[0].str, /anturia 100 ei löytynyt/i);
  });

  test('anturin numero on asetus (TEMP_SENSOR): anturi 101', () => {
    const addon = loadAddon(script, { components: { 'temperature:101': { tC: -20 } }, config: [{ m2: { c: 2 }, m: 60 }] });
    addon.config(0, true);
    addon.config(0, false);
    assert.match(addon.state.si[0].str, /anturia 100 ei löytynyt/i, 'oletus 100');

    addon.value('TEMP_SENSOR = 101');
    assert.equal(addon.config(0, false).m2.c, 8, 'anturin 101 lukema käytössä');
  });

  test('muiden ohjausten asetuksiin ei kosketa', () => {
    const addon = load(-20);
    addon.config(1, true);
    addon.config(1, false);
    assert.equal(addon.state.c.i[1].m2.c, 4);
    assert.equal(addon.state.si[1].str, '');
  });

  test('uusi asennus (asetuksia ei vielä ole) ei kaada lisäosaa', () => {
    const addon = loadAddon(script, { components: sensor(-20) });
    addon.state.c.i[0] = {};
    addon.config(0, true);
    assert.deepEqual(addon.state.c.i[0], {});
  });
});

describe(`${script}: pääskriptin kanssa`, () => {
  test('leuto sää: käytetään asetettua tuntimäärää', () => {
    const sim = boot({
      script, start: DAY_BEFORE,
      inst: { mode: 2, m2: { p: 24, c: 2 } },
      components: { 'temperature:100': { tC: 5 } }
    });

    assert.deepEqual(runDay(sim, DAY), hours([2, 3]));
  });

  test('-12 °C: 7 halvinta tuntia ja 45 minuuttia', () => {
    const sim = boot({
      script, start: DAY_BEFORE,
      inst: { mode: 2, m2: { p: 24, c: 2 } },
      components: { 'temperature:100': { tC: -12 } }
    });

    assert.deepEqual(runDay(sim, DAY), hours([0, 1, 2, 3, 4, 5, 23]));
    assert.equal(sim.evaluate('_.c.i[0].m'), 45);

    sim.advanceTo('2026-10-07T02:30:00');
    assert.equal(sim.relays[0], true);
    sim.advanceTo('2026-10-07T02:46:00');
    assert.equal(sim.relays[0], false, 'ohjausminuutit käytetty');
  });

  test('-20 °C: 8 halvinta tuntia', () => {
    const sim = boot({
      script, start: DAY_BEFORE,
      inst: { mode: 2, m2: { p: 24, c: 2 } },
      components: { 'temperature:100': { tC: -20 } }
    });

    assert.deepEqual(runDay(sim, DAY), hours([0, 1, 2, 3, 4, 5, 13, 23]));
  });
});
