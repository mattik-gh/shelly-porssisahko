/**
 * Lisäosa shelly-porssisahko-ht-sensor-temp.js: halvimpien tuntien määrä Shelly H&T:n lähettämän lämpötilan mukaan
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { boot, assertAlive } = require('../helpers');
const { loadAddon } = require('../sim/addon-alone');

const script = 'shelly-porssisahko-ht-sensor-temp.js';

describe(`${script}: yksin`, () => {
  /** Lisäosa, jolle pääskripti on lukenut asetukset: 2 tuntia, 60 minuuttia */
  const load = () => {
    const addon = loadAddon(script, { config: [{ m2: { c: 2 }, m: 60 }] });
    addon.config(0, true);
    return addon;
  };

  test('lisäosa rekisteröi päätepisteen update-temp ja käyttää USER_CONFIG-rajapintaa', () => {
    const addon = loadAddon(script);
    assert.deepEqual(addon.endpoints(), ['update-temp']);
    assert.equal(addon.has('USER_CONFIG'), true);
    assert.equal(addon.has('USER_OVERRIDE'), false);
  });

  test('ilman lämpötilatietoa käytetään käyttäjän arvoja', () => {
    const addon = load();
    const cfg = addon.config(0, false);
    assert.equal(cfg.m2.c, 2);
    assert.equal(cfg.m, 60);
    assert.match(addon.state.si[0].str, /Lämpötila ei tiedossa -> halvat tunnit: 2 h/);
  });

  test('lämpötilan vastaanotto: 200 ja pyyntö ajaa logiikka uudelleen', () => {
    const addon = load();
    const res = addon.request('temp=-7.5', 'update-temp');

    assert.equal(res.code, 200);
    assert.equal(res.sent, true);
    assert.equal(addon.state.si[0].chkTs, 0, 'pääskriptiä pyydetään ajamaan ohjauksen #1 logiikka');
    assert.equal(addon.state.si[1].chkTs, 1000, 'muihin ohjauksiin ei kosketa');
  });

  const cases = [
    //[lämpötila, tunnit, minuutit]
    ['3', 2, 60], ['-4.9', 2, 60], ['-5', 6, 45], ['-7.5', 6, 45], ['-10', 7, 45], ['-12', 7, 45], ['-15', 8, 60], ['-25.5', 8, 60]
  ];

  for (const [temp, h, m] of cases) {
    test(`${temp} °C -> ${h} tuntia, ${m} minuuttia`, () => {
      const addon = load();
      addon.request(`temp=${temp}`, 'update-temp');
      const cfg = addon.config(0, false);
      assert.equal(cfg.m2.c, h);
      assert.equal(cfg.m, m);
      assert.match(addon.state.si[0].str, new RegExp(`halvat tunnit: ${h} h, ohjaus: ${m} min`));
    });
  }

  test('H&T gen 1 lähettää myös kosteuden: lämpötila poimitaan parametreista', () => {
    const addon = load();
    assert.equal(addon.request('hum=45&temp=-16.2&id=shellyht-123', 'update-temp').code, 200);
    assert.equal(addon.config(0, false).m2.c, 8);
  });

  test('pyyntö ilman lämpötilaa: 400 eikä logiikkaa pyydetä ajamaan', () => {
    const addon = load();
    const res = addon.request('foo=1', 'update-temp');
    assert.equal(res.code, 400);
    assert.equal(res.sent, true);
    assert.equal(addon.state.si[0].chkTs, 1000);
  });

  test('lämpötilatieto vanhenee 12 tunnissa', () => {
    const addon = load();
    addon.request('temp=-20', 'update-temp');

    addon.advance(11.5 * 3600e3);
    assert.equal(addon.config(0, false).m2.c, 8, '11,5 h vanha tieto kelpaa');

    addon.advance(1 * 3600e3);
    const cfg = addon.config(0, false);
    assert.equal(cfg.m2.c, 2, '12,5 h vanhaa tietoa ei käytetä');
    assert.equal(cfg.m, 60);
    assert.match(addon.state.si[0].str, /liian vanha \(12\.5 h\)/);
  });

  test('uusi lämpötila korvaa vanhan', () => {
    const addon = load();
    addon.request('temp=-20', 'update-temp');
    assert.equal(addon.config(0, false).m2.c, 8);
    addon.request('temp=4', 'update-temp');
    assert.equal(addon.config(0, false).m2.c, 2);
  });

  test('muiden ohjausten asetuksiin ei kosketa', () => {
    const addon = load();
    addon.request('temp=-20', 'update-temp');
    addon.config(1, true);
    addon.config(1, false);
    assert.equal(addon.state.c.i[1].m2.c, 4);
  });
});

describe(`${script}: pääskriptin kanssa`, () => {
  test('ilman lämpötilatietoa käytetään asetettua tuntimäärää', () => {
    const sim = boot({ script, inst: { mode: 2, m2: { p: 24, c: 2 } } });

    assert.equal(sim.evaluate('_.c.i[0].m2.c'), 2);
    assert.match(sim.status(0).si.str, /ei tiedossa/);
  });

  test('H&T:n lähettämä lämpötila muuttaa tuntimäärää', () => {
    const sim = boot({ script, inst: { mode: 2, m2: { p: 24, c: 2 } } });

    assert.equal(sim.request('temp=-7.5', 'update-temp').code, 200);
    sim.settle();
    assertAlive(sim);

    assert.equal(sim.evaluate('_.c.i[0].m2.c'), 6);
    assert.equal(sim.evaluate('_.c.i[0].m'), 45);
    assert.match(sim.status(0).si.str, /-7\.5°C/);
  });

  test('pyyntö ilman lämpötilaa palauttaa 400', () => {
    const sim = boot({ script });
    assert.equal(sim.request('foo=1', 'update-temp').code, 400);
  });
});
