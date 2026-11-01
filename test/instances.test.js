/**
 * Ohjausten määrä asetuksena: käytössä olevat ohjaukset luodaan yleisten asetusten
 * (cnt) mukaan, ja käyttämättömät eivät vie muistia.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { boot, assertAlive } = require('./helpers');
const { createSim } = require('./sim/shelly-sim');

const counts = (sim) => sim.evaluate('[_.si.length, _.c.i.length, _.h.length, cmd.length, instCnt]');

describe('ohjausten määrä', () => {
  test('uusi asennus (ei asetuksia): oletus on yksi ohjaus ja se tallennetaan asetuksiin', () => {
    const sim = createSim();
    sim.settle();
    assertAlive(sim);

    assert.deepEqual(counts(sim), [1, 1, 1, 1, 1]);
    assert.equal(sim.cfg(-1).cnt, 1);
    assert.deepEqual([...sim.kvs.keys()].sort(), ['porssisahko', 'porssisahko-1']);
  });

  test('uudessa asennuksessa määrän voi nostaa asetuksista kolmeen', () => {
    const sim = createSim();
    sim.settle();
    sim.saveConfig(-1, {}, { cnt: 3 });
    assertAlive(sim);

    assert.deepEqual(counts(sim), [3, 3, 3, 3, 3]);
    assert.deepEqual([...sim.kvs.keys()].sort(), ['porssisahko', 'porssisahko-1', 'porssisahko-2', 'porssisahko-3']);
  });

  test('myöhemmin lisätty ohjaus saa oletusasetukset, ei kopiota ohjauksesta #1', () => {
    const sim = createSim();
    sim.settle();
    const defaults = sim.cfg(0);

    //Ohjaus #1 otetaan käyttöön omilla asetuksillaan, ja vasta sen jälkeen määrä nostetaan kolmeen
    sim.saveConfig(0, { en: 1, mode: 2, m2: { p: 6, c: 2.5, m: 20, s: 1 }, o: [1], b: 30, f: 3, fc: 1, i: 1, q: 2 }, { names: ['Varaaja'] });
    sim.saveConfig(-1, {}, { cnt: 3 });
    assertAlive(sim);

    assert.deepEqual(sim.cfg(1), defaults);
    assert.deepEqual(sim.cfg(2), defaults);
    assert.equal(sim.cfg(0).m2.c, 2.5, 'ohjauksen #1 asetukset ovat ennallaan');
    assert.deepEqual(sim.cfg(-1).names, ['Varaaja', '-', '-']);

    //Ohjauksilla ei ole yhteisiä olioita
    assert.equal(sim.evaluate('_.c.i[1].m2 === _.c.i[2].m2'), false);
    assert.equal(sim.evaluate('_.c.i[1].o === _.c.i[2].o'), false);
  });

  test('aiemmin tallennetut ohjauksen asetukset otetaan käyttöön, kun määrä nostetaan takaisin', () => {
    const sim = boot({ common: { cnt: 2 }, kvs: { 'porssi-2': { en: 1, mode: 0, m0: { c: 1 }, o: [1] } } });
    assert.equal(sim.relays[1], true);

    sim.saveConfig(-1, {}, { cnt: 1 });
    sim.saveConfig(-1, {}, { cnt: 2 });
    assertAlive(sim);
    assert.equal(sim.status(1).ci.en, 1);
    assert.deepEqual(sim.status(1).ci.o, [1]);
  });

  test('päivitys versiosta 3.x (asetukset ilman määrää): kaikki kolme ohjausta pysyvät käytössä', () => {
    //Versio 3.x loi aina kolme ohjausta. Tässä vain #3 on käytössä - se ei saa kadota
    const sim = createSim({
      kvs: {
        'porssi': { g: 'fi', vat: 25.5, day: 0, night: 0, names: ['-', '-', 'Kolmas'] },
        'porssi-1': { en: 0, mode: 0, m0: { c: 0 }, o: [0] },
        'porssi-2': { en: 0, mode: 0, m0: { c: 0 }, o: [0] },
        'porssi-3': { en: 1, mode: 0, m0: { c: 1 }, o: [2] }
      }
    });
    sim.settle();
    assertAlive(sim);

    assert.deepEqual(counts(sim), [3, 3, 3, 3, 3]);
    assert.equal(sim.cfg(-1).cnt, 3, 'määrä tallennetaan asetuksiin');
    assert.equal(sim.relays[2], true, 'ohjaus #3 toimii');
  });

  test('yleiset asetukset eivät ole luettavissa käynnistyksessä: kaikki kolme ohjausta pysyvät käytössä', () => {
    const sim = createSim({
      kvs: {
        'porssi': '{rikki',
        'porssi-3': { en: 1, mode: 0, m0: { c: 1 }, o: [2] }
      }
    });
    sim.settle();
    assertAlive(sim);

    assert.deepEqual(counts(sim), [3, 3, 3, 3, 3]);
    assert.equal(sim.relays[2], true, 'ohjaus #3 toimii');
  });

  test('yleiset asetukset eivät ole luettavissa ajon aikana: tallennettu määrä pysyy', () => {
    const sim = boot({ common: { cnt: 2 } });
    assert.deepEqual(counts(sim), [2, 2, 2, 2, 2]);

    sim.kvs.set('porssisahko', '{rikki');
    sim.get('r=r&i=0');
    sim.settle();
    assertAlive(sim);
    assert.deepEqual(counts(sim), [2, 2, 2, 2, 2]);
  });

  test('tallennettu määrä 1 pysyy (ei tulkita vanhaksi asennukseksi)', () => {
    const sim = boot({ common: { cnt: 1 } });
    assert.deepEqual(counts(sim), [1, 1, 1, 1, 1]);
  });

  test('vanha asennus ilman asetusta saa kolme ohjausta', () => {
    const sim = boot({ common: { names: ['A', 'B', 'C'] }, kvs: { 'porssi-3': { en: 1, mode: 0, m0: { c: 1 }, o: [2] } } });
    assert.deepEqual(counts(sim), [3, 3, 3, 3, 3]);
    assert.equal(sim.relays[2], true);
    assert.equal(sim.status(0).c.cnt, 3);
  });

  for (const cnt of [1, 2]) {
    test(`${cnt} ohjausta: vain ne luodaan`, () => {
      const sim = boot({
        common: { cnt },
        inst: { mode: 0, m0: { c: 1 }, o: [0] },
        kvs: {
          'porssi-2': { en: 1, mode: 0, m0: { c: 1 }, o: [1] },
          'porssi-3': { en: 1, mode: 0, m0: { c: 1 }, o: [2] }
        }
      });
      sim.advance(2 * 3600e3);
      assertAlive(sim);

      assert.deepEqual(counts(sim), [cnt, cnt, cnt, cnt, cnt]);
      assert.equal(sim.relays[0], true);
      assert.equal(sim.relays[1], cnt >= 2 ? true : undefined);
      assert.equal(sim.relays[2], undefined, 'kolmatta ohjausta ei ajeta');
      assert.equal(sim.status(0).c.names.length >= cnt, true);
      assert.equal(sim.get(`r=s&i=${cnt}`).json.si, undefined);
      assert.equal(sim.status(0).s.enCnt, cnt);
    });
  }

  test('yksi ohjaus tuoreessa asennuksessa: muiden asetuksia ei luoda KVS:ään', () => {
    const sim = createSim({ kvs: { porssisahko: "[1,'fi',25.5,0,0,['-'],1,24]" } });
    sim.settle();
    assertAlive(sim);

    assert.deepEqual([...sim.kvs.keys()].sort(), ['porssisahko', 'porssisahko-1']);
    assert.deepEqual(sim.status(0).c.names, ['-']);
  });

  test('määrän pienentäminen ajon aikana poistaa viimeiset ohjaukset', () => {
    const sim = boot({
      inst: { mode: 0, m0: { c: 1 }, o: [0] },
      kvs: { 'porssi-2': { en: 1, mode: 0, m0: { c: 1 }, o: [1] }, 'porssi-3': { en: 1, mode: 0, m0: { c: 1 }, o: [2] } }
    });
    assert.deepEqual(sim.relays, { 0: true, 1: true, 2: true });
    assert.deepEqual(sim.switchLog.slice(0, 3).map(s => s.id), [0, 1, 2]);

    //Tallennus ohjauksen #3 sivulta, kuten käyttöliittymä tekee
    sim.saveConfig(2, {}, { cnt: 1 });
    assertAlive(sim);
    assert.deepEqual(counts(sim), [1, 1, 1, 1, 1]);

    //Poistettujen ohjausten lähtöihin ei enää kosketa (ne jäävät viimeiseen tilaansa)
    const n = sim.switchLog.length;
    sim.advance(3 * 3600e3);
    assertAlive(sim);
    assert.deepEqual([...new Set(sim.switchLog.slice(n).map(s => s.id))], [0]);
    assert.equal(sim.get('r=s&i=2').json.si, undefined);
    assert.equal(sim.get('r=h&i=2').body, '');
  });

  test('määrän kasvattaminen ajon aikana luo uudet ohjaukset pois käytöstä', () => {
    const sim = boot({ common: { cnt: 1 }, inst: { mode: 2, m2: { p: 12, c: 3 }, o: [0, 1] } });
    assert.deepEqual(counts(sim), [1, 1, 1, 1, 1]);

    sim.saveConfig(0, {}, { cnt: 3 });
    assertAlive(sim);
    assert.deepEqual(counts(sim), [3, 3, 3, 3, 3]);

    for (const i of [1, 2]) {
      const st = sim.status(i);
      assert.equal(st.ci.en, 0, 'uusi ohjaus on pois käytöstä');
      assert.equal(st.si.cmd, -1);
      assert.equal(st.ci.m2.ps2, 0, 'asetusrakenne on täydellinen');
      assert.ok(sim.kvs.has(`porssisahko-${i + 1}`), 'asetukset tallennetaan KVS:ään');
    }
    assert.deepEqual(sim.status(0).c.names, ['-', '-', '-']);
    assert.notEqual(sim.evaluate('_.c.i[1].m2 === _.c.i[0].m2'), true, 'ohjaukset eivät jaa asetusolioita');

    //Uusi ohjaus otetaan käyttöön
    sim.saveConfig(2, { en: 1, mode: 0, m0: { c: 1 }, o: [2] });
    assert.equal(sim.relays[2], true);
  });

  test('aiemmin tallennetut asetukset palaavat, kun määrää kasvatetaan', () => {
    const sim = boot({
      common: { cnt: 1 },
      kvs: { 'porssi-2': { en: 1, mode: 0, m0: { c: 1 }, o: [1] } }
    });
    assert.equal(sim.relays[1], undefined);

    sim.saveConfig(0, {}, { cnt: 2 });
    assert.equal(sim.status(1).ci.en, 1);
    assert.equal(sim.relays[1], true);
  });

  for (const value of [0, 4, 99, -1, 'abc', null, 2.7]) {
    test(`virheellinen tai liian suuri määrä (${JSON.stringify(value)}) korjataan`, () => {
      const sim = boot({ common: { cnt: value }, inst: { mode: 0, m0: { c: 1 } } });
      assertAlive(sim);

      const expected = value === 2.7 ? 2 : 3;
      assert.equal(sim.status(0).c.cnt, expected);
      assert.equal(sim.evaluate('instCnt'), expected);
      assert.equal(sim.cfg(-1).cnt, expected, 'korjattu arvo tallennetaan');
      assert.equal(sim.relays[0], true);
    });
  }

  test('yhden ohjauksen versiossa (INSTANCE_COUNT = 1) määrä on aina 1', () => {
    const sim = boot({ prelude: 'let INSTANCE_COUNT = 1;', common: { cnt: 3 }, inst: { mode: 0, m0: { c: 1 } } });
    assertAlive(sim);
    assert.deepEqual(counts(sim), [1, 1, 1, 1, 1]);
    assert.equal(sim.status(0).c.cnt, 1);
  });

  test('latauspyyntö poistetulle ohjaukselle ei kaada skriptiä', () => {
    const sim = boot({ common: { cnt: 1 }, inst: { mode: 0, m0: { c: 1 } } });
    for (const q of ['r=r&i=1', 'r=r&i=2', 'r=f&i=2&ts=9999999999&c=1', 'r=c&i=2', 'r=h&i=1']) {
      sim.get(q);
      sim.settle();
      assertAlive(sim);
    }
    assert.equal(sim.relays[0], true);
  });

  test('ajojärjestys säilyy, kun määrä on kaksi', () => {
    const sim = boot({
      start: '2026-10-06T10:10:00',
      common: { cnt: 2 },
      inst: { mode: 0, m0: { c: 1 }, o: [0] },
      kvs: { 'porssi-2': { en: 1, mode: 0, m0: { c: 1 }, o: [1] } }
    });
    const n = sim.switchLog.length;
    sim.advanceTo('2026-10-06T12:01:00');
    assert.deepEqual(sim.switchLog.slice(n).map(s => s.id), [0, 1, 0, 1]);
  });
});
