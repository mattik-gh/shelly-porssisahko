/**
 * Asetusten muuttaminen HTTP-pyynnöllä (r=w)
 *
 * Ulkoinen järjestelmä voi muuttaa ohjauksen asetuksia nimetyillä parametreilla tuntematta tallennusmuotoa:
 * en (käytössä), o (lähdöt), f (pakko-ohjatut tunnit merkkijonona), m2.c ja m2.c2 (tuntimäärät),
 * m1.l, m2.l ja m2.m (hintarajat) sekä m0.c (käsiohjauksen tila). Muut asetukset tehdään asetussivulla.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { boot, assertAlive } = require('./helpers');

const START = '2026-10-05T10:20:00';
const NONE = '-'.repeat(24);

/** Lähettää pyynnön ja odottaa, että asetukset on tallennettu ja ladattu */
function write(sim, query) {
  const code = sim.get(`r=w&${query}`).code;
  sim.advance(5000);
  assertAlive(sim);
  return code;
}

/** Laskee KVS-kirjoitukset */
function countWrites(sim) {
  const counter = { n: 0 };
  const set = sim.kvs.set.bind(sim.kvs);
  sim.kvs.set = (key, value) => { counter.n++; return set(key, value); };
  return counter;
}

describe('asetusten muuttaminen HTTP-pyynnöllä (r=w)', () => {
  test('tuntimäärä: tallentuu, tulee voimaan heti ja muut asetukset säilyvät', () => {
    //Hinta on tunnin numero + 1, joten halvimmat tunnit ovat päivän ensimmäiset
    const sim = boot({ start: START, inst: { mode: 2, m2: { p: 24, c: 5 }, o: [0], b: 30 }, price: (e, d) => d.getHours() + 1 });
    const before = sim.status(0).ci;
    assert.equal(sim.relays[0], false, 'kello 10 ei kuulu viiteen halvimpaan');

    assert.equal(write(sim, 'i=0&m2.c=12'), 204);
    assert.equal(sim.cfg(0).m2.c, 12, 'tallennettu laitteen muistiin');
    assert.equal(sim.status(0).ci.m2.c, 12);
    assert.equal(sim.relays[0], true, 'kello 10 kuuluu kahteentoista halvimpaan');
    assert.deepEqual(Object.assign({}, sim.status(0).ci, { m2: Object.assign({}, sim.status(0).ci.m2, { c: 5 }) }), before, 'muut asetukset ennallaan');

    assert.equal(write(sim, 'i=0&m2.c=1.5&m2.c2=0.25'), 204);
    assert.equal(sim.cfg(0).m2.c, 1.5);
    assert.equal(sim.cfg(0).m2.c2, 0.25);
  });

  test('käytössä: ohjauksen voi ottaa pois käytöstä ja takaisin', () => {
    const sim = boot({ start: START, inst: { mode: 0, m0: { c: 1 } } });
    assert.equal(sim.relays[0], true);

    assert.equal(write(sim, 'i=0&en=0'), 204);
    assert.equal(sim.cfg(0).en, 0);
    assert.equal(sim.status(0).ci.en, 0);

    assert.equal(write(sim, 'i=0&en=1'), 204);
    assert.equal(sim.cfg(0).en, 1);
    assert.equal(sim.relays[0], true);
  });

  test('lähdöt: lista korvataan, pilkku kelpaa myös koodattuna, tyhjä arvo poistaa lähdöt', () => {
    const sim = boot({ start: START, switches: [0, 1, 2, 3], inst: { mode: 0, m0: { c: 1 }, o: [0] } });
    assert.equal(!!sim.relays[1], false);

    assert.equal(write(sim, 'i=0&o=0,1'), 204);
    assert.deepEqual(sim.cfg(0).o, [0, 1]);
    assert.equal(sim.relays[1], true, 'uusi lähtö otettiin ohjaukseen');

    assert.equal(write(sim, 'i=0&o=2%2C3'), 204);
    assert.deepEqual(sim.cfg(0).o, [2, 3]);

    assert.equal(write(sim, 'i=0&o=1'), 204);
    assert.deepEqual(sim.cfg(0).o, [1]);

    assert.equal(write(sim, 'i=0&o='), 204);
    assert.deepEqual(sim.cfg(0).o, []);
  });

  test('pakko-ohjatut tunnit: merkkijono, jossa 1 = päälle, 0 = pois ja - = ei pakko-ohjausta', () => {
    const sim = boot({ start: START, inst: { mode: 0, m0: { c: 0 } } });
    assert.equal(sim.relays[0], false);

    //Tunnit 10 ja 11 päälle, tunti 23 pois
    const f = NONE.split('');
    f[10] = '1'; f[11] = '1'; f[23] = '0';
    assert.equal(write(sim, `i=0&f=${f.join('')}`), 204);
    assert.equal(sim.cfg(0).f, (1 << 10) | (1 << 11) | (1 << 23));
    assert.equal(sim.cfg(0).fc, (1 << 10) | (1 << 11));
    assert.equal(sim.relays[0], true, 'kello on 10: pakko-ohjattu tunti');
    assert.equal(sim.status(0).si.st, 10, 'selite: pakko-ohjattu tunti');

    //Kaikki pois
    assert.equal(write(sim, `i=0&f=${NONE}`), 204);
    assert.equal(sim.cfg(0).f, 0);
    assert.equal(sim.cfg(0).fc, 0);
    assert.equal(sim.relays[0], false);

    //Kaikki 24 tuntia
    assert.equal(write(sim, `i=0&f=${'1'.repeat(24)}`), 204);
    assert.equal(sim.cfg(0).f, 16777215);
    assert.equal(sim.cfg(0).fc, 16777215);
    assert.equal(write(sim, `i=0&f=${'0'.repeat(24)}`), 204);
    assert.equal(sim.cfg(0).f, 16777215);
    assert.equal(sim.cfg(0).fc, 0);
  });

  test('hintarajat: luku tai avg', () => {
    const sim = boot({ start: START, inst: { mode: 1, m1: { l: 5 } }, price: () => 10 });
    assert.equal(sim.relays[0], false);

    assert.equal(write(sim, 'i=0&m1.l=12.5'), 204);
    assert.equal(sim.cfg(0).m1.l, 12.5);
    assert.equal(sim.relays[0], true, 'hinta 10 on rajan 12,5 alla');

    assert.equal(write(sim, 'i=0&m1.l=avg&m2.l=-5&m2.m=avg'), 204);
    assert.equal(sim.cfg(0).m1.l, 'avg');
    assert.equal(sim.cfg(0).m2.l, -5);
    assert.equal(sim.cfg(0).m2.m, 'avg');
  });

  test('useita asetuksia yhdessä pyynnössä tallennetaan yhdellä kirjoituksella', () => {
    const sim = boot({ start: START, inst: { mode: 2, m2: { p: 24, c: 2 } } });
    const writes = countWrites(sim);
    assert.equal(write(sim, 'i=0&en=1&o=0&m2.c=3&m2.l=4&f=' + NONE), 204);
    assert.equal(writes.n, 1);
    assert.equal(sim.cfg(0).m2.c, 3);
    assert.equal(sim.cfg(0).m2.l, 4);
  });

  test('samat arvot uudelleen eivät kirjoita laitteen muistiin', () => {
    const sim = boot({ start: START, inst: { mode: 2, m2: { p: 24, c: 2 }, o: [0] } });
    const writes = countWrites(sim);
    assert.equal(write(sim, 'i=0&m2.c=2&o=0&en=1&f=' + NONE), 204);
    assert.equal(writes.n, 0);
  });

  test('toinen ohjaus: pyyntö koskee vain annettua ohjausta', () => {
    const sim = boot({ start: START, common: { cnt: 2 }, inst: { mode: 2, m2: { p: 24, c: 2 } }, kvs: { 'porssi-2': { en: 1, mode: 2, m2: { p: 24, c: 2 }, o: [1] } } });
    assert.equal(write(sim, 'i=1&m2.c=7'), 204);
    assert.equal(sim.cfg(1).m2.c, 7);
    assert.equal(sim.cfg(0).m2.c, 2);
  });

  for (const [what, query] of [
    ['ei yhtään asetusta', 'i=0'],
    ['tuntematon asetus', 'i=0&mode=1'],
    ['yleinen asetus', 'i=0&vat=10'],
    ['käytössä muu kuin 0 tai 1', 'i=0&en=2'],
    ['käytössä tyhjä', 'i=0&en='],
    ['käsiohjauksen tila muu kuin 0 tai 1', 'i=0&m0.c=2'],
    ['tuntimäärä tekstinä', 'i=0&m2.c=abc'],
    ['tuntimäärä tyhjä', 'i=0&m2.c='],
    ['tuntimäärä negatiivinen', 'i=0&m2.c=-1'],
    ['tuntimäärä liian suuri', 'i=0&m2.c=25'],
    ['tuntimäärä ääretön', 'i=0&m2.c=Infinity'],
    ['hintaraja tekstinä', 'i=0&m1.l=halpa'],
    ['hintaraja liian suuri', 'i=0&m2.m=1000'],
    ['lähtö tekstinä', 'i=0&o=a'],
    ['lähtö desimaalina', 'i=0&o=1.5'],
    ['lähtö negatiivinen', 'i=0&o=-1'],
    ['viisi lähtöä', 'i=0&o=0,1,2,3,4'],
    ['pakko-ohjatut tunnit liian lyhyt', 'i=0&f=' + '-'.repeat(23)],
    ['pakko-ohjatut tunnit liian pitkä', 'i=0&f=' + '-'.repeat(25)],
    ['pakko-ohjatuissa tunneissa väärä merkki', 'i=0&f=' + '-'.repeat(23) + 'x'],
    ['parametri ilman arvoa', 'i=0&en'],
    ['ohjaus, jota ei ole', 'i=5&en=1'],
    ['ohjauksen numero puuttuu', 'en=1'],
    ['yksi kelvoton arvo muiden joukossa', 'i=0&m2.c=3&en=7'],
  ]) {
    test(`virheellinen pyyntö hylätään eikä mitään kirjoiteta: ${what}`, () => {
      const sim = boot({ start: START, inst: { mode: 2, m2: { p: 24, c: 2 } } });
      const before = sim.kvs.get('porssisahko-1');
      const writes = countWrites(sim);
      assert.equal(write(sim, query), 400);
      assert.equal(writes.n, 0);
      assert.equal(sim.kvs.get('porssisahko-1'), before);
    });
  }

  test('laite rajaa tuntimäärän jakson pituuteen, vaikka pyyntö antaa suuremman', () => {
    const sim = boot({ start: START, inst: { mode: 2, m2: { p: 6, c: 2 } }, price: (e, d) => d.getHours() + 1 });
    assert.equal(write(sim, 'i=0&m2.c=20'), 204);
    assert.equal(sim.cfg(0).m2.c, 20, 'arvo tallennetaan annettuna');
    assert.equal(sim.relays[0], true, 'jakson kaikki tunnit ovat käytössä');
  });

  test('pyyntö ei muuta version 3.x asetuksia eikä yleisiä asetuksia', () => {
    const sim = boot({ start: START, inst: { mode: 2, m2: { p: 24, c: 2 } }, common: { names: ['Varaaja', '-', '-'] } });
    const old = sim.kvs.get('porssi-1');
    const common = sim.kvs.get('porssisahko');
    assert.equal(write(sim, 'i=0&m2.c=9'), 204);
    assert.equal(sim.kvs.get('porssi-1'), old);
    assert.equal(sim.kvs.get('porssisahko'), common);
  });

  test('käsiohjauksen tila: m0.c vaihtaa tilan, myös muiden asetusten kanssa samassa pyynnössä', () => {
    const sim = boot({ start: START, inst: { mode: 0, m0: { c: 0 } } });
    assert.equal(write(sim, 'i=0&m0.c=1'), 204);
    assert.equal(sim.cfg(0).m0.c, 1);
    assert.equal(sim.relays[0], true);

    assert.equal(write(sim, 'i=0&m0.c=0&m2.c=3'), 204);
    assert.equal(sim.cfg(0).m0.c, 0);
    assert.equal(sim.cfg(0).m2.c, 3);
    assert.equal(sim.relays[0], false);
    assert.equal(sim.status(0).ci.mode, 0, 'ohjaustapaa ei vaihdeta');
  });
});
