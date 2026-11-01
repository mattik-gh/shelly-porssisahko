/**
 * Erillinen asetusskripti (src/after-build/shelly-porssisahko-config.js)
 *
 * Skripti asennetaan pääskriptin rinnalle. Se kirjoittaa valitut asetukset KVS:ään,
 * pyytää pääskriptiä lataamaan ne ja pysäyttää itsensä.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { boot, assertAlive } = require('./helpers');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'after-build', 'shelly-porssisahko-config.js'), 'utf8');

/**
 * Ottaa asetusrivin käyttöön kuten käyttäjä tekisi: poistaa kommenttimerkin ja vaihtaa arvon.
 *
 * @param {string} src lähdekoodi
 * @param {string} key asetuksen nimi, esim. "vat" tai "m2.c"
 * @param {string} value uusi arvo lähdekoodina (esim. "10" tai "[1]")
 * @param {number} inst ohjaus (0 = #1, 1 = #2, 2 = #3), tyhjä = yleiset asetukset
 */
function set(src, key, value, inst) {
  //Pohjan osiot: yleiset asetukset, ohjaus #1, #2, #3 ja koodi
  const marks = ['// Ohjaus #1', '// Ohjaus #2', '// Ohjaus #3', '// Koodi alkaa'].map(m => src.indexOf(m));
  assert.ok(marks.every(m => m > 0), 'pohjan osiot löytyvät');
  const from = inst === undefined ? 0 : marks[inst];
  const to = inst === undefined ? marks[0] : marks[inst + 1];
  let section = src.substring(from, to);

  //Sisäkkäinen asetus (esim. m2.c): haetaan ensin olion alku
  const parts = key.split('.');
  const start = parts.length > 1 ? section.indexOf(`${parts[0]}: {`) : 0;
  assert.ok(start >= 0, `${parts[0]} löytyy`);

  const re = new RegExp(`//${parts[parts.length - 1]}: [^\\n]*`);
  const tail = section.substring(start);
  assert.match(tail, re, `asetus ${key} löytyy pohjasta`);
  section = section.substring(0, start) + tail.replace(re, `${parts[parts.length - 1]}: ${value},`);

  return src.substring(0, from) + section + src.substring(to);
}

/** Ajaa asetusskriptin ja odottaa, että se on valmis */
function run(sim, code) {
  sim.runScript(code, 'shelly-porssisahko-config.js');
  sim.advance(30e3);
  sim.settle();
  assertAlive(sim);
}

//Asetukset loogisella nimellä: 'porssi' = yleiset, 'porssi-1'... = ohjaukset (uudet avaimet, listamuoto)
const kvs = (sim, key) => sim.cfg(key == 'porssi' ? -1 : Number(key.split('-')[1]) - 1);

describe('asetusskripti', () => {
  test('pohja sellaisenaan ei muuta asetuksia ja pysäyttää itsensä', () => {
    const sim = boot({ inst: { mode: 1, m1: { l: 5 }, o: [0, 1] }, common: { vat: 10 } });
    const KEYS = ['porssisahko', 'porssisahko-1', 'porssisahko-2', 'porssisahko-3'];
    const before = KEYS.map(k => sim.kvs.get(k));
    assert.ok(before.every(v => typeof v === 'string' && v.startsWith('[1,')), 'asetukset ovat uusissa avaimissa listamuodossa');
    const old = ['porssi', 'porssi-1'].map(k => sim.kvs.get(k));

    run(sim, SOURCE);

    assert.deepEqual(KEYS.map(k => sim.kvs.get(k)), before);
    assert.deepEqual(['porssi', 'porssi-1'].map(k => sim.kvs.get(k)), old, 'version 3.x asetuksiin ei kosketa');
    assert.equal(sim.stoppedScripts.length, 1);
    assert.ok(sim.logLines().some(l => l === 'Config changed'), 'latauspyyntö onnistui');
  });

  test('pohjassa ovat kaikki pääskriptin asetukset', () => {
    //Asetukset, jotka pääskripti luo uuteen laitteeseen
    const sim = boot();
    const keys = (obj, prefix = '') => Object.keys(obj).flatMap(k => typeof obj[k] === 'object' && !Array.isArray(obj[k]) ? keys(obj[k], `${prefix}${k}.`) : [`${prefix}${k}`]);

    for (const key of keys(kvs(sim, 'porssi'))) {
      assert.match(SOURCE, new RegExp(`^\\s*//${key}: `, 'm'), `yleinen asetus ${key}`);
    }

    for (const key of keys(kvs(sim, 'porssi-1'))) {
      const name = key.split('.').pop();
      assert.equal((SOURCE.match(new RegExp(`^\\s*//${name}: `, 'gm')) || []).length >= 3, true, `ohjauksen asetus ${key} kaikille kolmelle ohjaukselle`);
    }
  });

  test('yleiset asetukset: ALV, ohjausten määrä ja historian pituus', () => {
    const sim = boot();
    let code = set(SOURCE, 'vat', '10');
    code = set(code, 'cnt', '2');
    code = set(code, 'hist', '48');

    run(sim, code);

    const st = sim.status(0).c;
    assert.equal(st.vat, 10);
    assert.equal(st.cnt, 2);
    assert.equal(st.hist, 48);
    assert.equal(st.g, 'fi', 'muut asetukset säilyvät');
    assert.deepEqual(Object.keys(sim.status(2)).sort(), ['c', 's'], 'ohjaus #3 ei ole enää käytössä');
  });

  test('ohjauksen #1 asetus tulee voimaan ilman uudelleenkäynnistystä', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 0 } } });
    assert.equal(sim.relays[0], false);

    run(sim, set(SOURCE, 'm0.c', '1', 0));

    assert.equal(sim.status(0).ci.m0.c, 1);
    assert.equal(sim.relays[0], true);
  });

  test('ohjausten #2 ja #3 asetukset tulevat voimaan ilman uudelleenkäynnistystä', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 0 } } });
    let code = SOURCE;
    for (const inst of [1, 2]) {
      code = set(code, 'en', '1', inst);
      code = set(code, 'o', `[${inst}]`, inst);
      code = set(code, 'm0.c', '1', inst);
    }

    run(sim, code);

    assert.equal(sim.status(1).ci.en, 1);
    assert.equal(sim.status(1).ci.m0.c, 1);
    assert.deepEqual(sim.status(1).ci.o, [1]);
    assert.equal(sim.status(2).ci.m0.c, 1);
    assert.equal(sim.relays[1], true, 'ohjaus #2 ohjaa lähtöä 1');
    assert.equal(sim.relays[2], true, 'ohjaus #3 ohjaa lähtöä 2');
  });

  test('lähtölistan voi lyhentää', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 }, o: [0, 1] } });
    assert.deepEqual(sim.relays, { 0: true, 1: true });

    run(sim, set(SOURCE, 'o', '[1]', 0));

    assert.deepEqual(kvs(sim, 'porssi-1').o, [1]);
    assert.deepEqual(sim.status(0).ci.o, [1]);
  });

  test('nimilista korvataan kokonaan', () => {
    const sim = boot({ common: { names: ['Varaaja', 'Lattia', 'Auto'] } });
    run(sim, set(SOURCE, 'names', "['A', 'B', 'C']"));
    assert.deepEqual(sim.status(0).c.names, ['A', 'B', 'C']);
  });

  test('hinnan tarkkuus ja tuntimäärä desimaaleina', () => {
    const sim = boot({ inst: { mode: 2, m2: { p: 24, c: 1 } } });
    let code = set(SOURCE, 'q', '1', 0);
    code = set(code, 'm2.c', '1.5', 0);

    run(sim, code);

    const ci = sim.status(0).ci;
    assert.equal(ci.q, 1);
    assert.equal(ci.m2.c, 1.5);
    assert.equal(ci.m2.p, 24, 'muut m2-asetukset säilyvät');
  });

  test('latauspyyntö menee perille, vaikka pääskriptin suoritus on aktiivinen', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 0 } } });
    //Pääskripti hakee hintoja hitaasti, kun asetusskripti ajetaan
    sim.net.delay = 4000;
    sim.evaluate('(_.s.p[0].ts = 0, 0)');
    sim.advance(11e3);

    run(sim, set(SOURCE, 'm0.c', '1', 0));

    assert.equal(sim.relays[0], true);
  });

  test('skriptin numero: pyyntö tehdään asetettuun osoitteeseen', () => {
    assert.match(SOURCE, /"http:\/\/localhost\/script\/" \+ MAIN_SRIPT_NUMBER \+ "\?r=r"/);
  });
});
