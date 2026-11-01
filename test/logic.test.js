/**
 * Ohjauslogiikan testit: mitkä tunnit ohjataan päälle eri asetuksilla.
 *
 * Hintoina käytetään simulaattorin oletushintoja (c/kWh, ALV 0 %):
 *
 *   tunti  00 01 02  03  04 05 06 07 08 09 10 11 12 13  14  15 16 17 18 19 20 21 22 23
 *   hinta   3  2  1 1.5 2.5  4  8 12 14 11  9  7  6  5 5.5 6.5  9 13 16 15 12  9  6  4
 *
 * Keskiarvo on 7.583 c/kWh.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { boot, assertAlive, runDay, hours, mask, DAY_BEFORE, DAY } = require('./helpers');

const BELOW_AVG = [0, 1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 22, 23];

/** Käynnistää edellisenä iltana ja palauttaa päivän tunnit, joilla lähtö on päällä */
function day(inst, opts = {}) {
  const sim = boot(Object.assign({ start: DAY_BEFORE, inst }, opts));
  return runDay(sim, DAY);
}

describe('käsiohjaus (mode 0)', () => {
  test('päällä', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 } } });
    assert.equal(sim.relays[0], true);
    assert.equal(sim.status(0).si.st, 1);
    assert.equal(sim.status(0).si.cmd, 1);
  });

  test('pois', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 0 } } });
    assert.equal(sim.relays[0], false);
    assert.equal(sim.status(0).si.st, 1);
  });

  test('toimii ilman hintoja', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 } }, settle: false });
    sim.net.mode = 'error';
    sim.settle();
    assert.equal(sim.relays[0], true);
    assert.equal(sim.status(0).si.st, 1);
  });
});

describe('hintaraja (mode 1)', () => {
  test('päällä kun hinta <= raja', () => {
    assert.deepEqual(day({ mode: 1, m1: { l: 5 } }), hours([0, 1, 2, 3, 4, 5, 13, 23]));
  });

  test('raja "avg" käyttää päivän keskiarvoa', () => {
    assert.deepEqual(day({ mode: 1, m1: { l: 'avg' } }), hours(BELOW_AVG));
  });

  test('tilakoodit 2 (alle rajan) ja 3 (yli rajan)', () => {
    const sim = boot({ start: '2026-10-06T02:10:00', inst: { mode: 1, m1: { l: 5 } } });
    assert.equal(sim.status(0).si.st, 2);
    sim.advanceTo('2026-10-06T08:10:00');
    assert.equal(sim.status(0).si.st, 3);
  });
});

describe('jakson halvimmat tunnit (mode 2)', () => {
  test('4 halvinta tuntia vuorokaudesta', () => {
    assert.deepEqual(day({ mode: 2, m2: { p: 24, c: 4 } }), hours([1, 2, 3, 4]));
  });

  test('samanhintaisista valitaan aikaisempi', () => {
    //tunnit 05 ja 23 maksavat molemmat 4 c/kWh, kuudes halvin on 05
    assert.deepEqual(day({ mode: 2, m2: { p: 24, c: 6 } }), hours([0, 1, 2, 3, 4, 5]));
  });

  test('3 peräkkäistä tuntia', () => {
    assert.deepEqual(day({ mode: 2, m2: { p: 24, c: 3, s: 1 } }), hours([1, 2, 3]));
  });

  test('peräkkäiset tunnit eivät ole samat kuin halvimmat yksittäiset', () => {
    const price = (e, d) => [1, 9, 1, 9, 2, 2, 2, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9][d.getHours()];
    assert.deepEqual(day({ mode: 2, m2: { p: 24, c: 3, s: 0 } }, { price }), hours([0, 2, 4]));
    assert.deepEqual(day({ mode: 2, m2: { p: 24, c: 3, s: 1 } }, { price }), hours([4, 5, 6]));
  });

  describe('peräkkäiset tunnit tasatilanteessa', () => {
    //Kun usea ikkuna on täsmälleen yhtä halpa, valittu ikkuna saa olla mikä tahansa niistä.
    //Lopputuloksen pitää silti olla yksi yhtenäinen, oikean mittainen ja halvin mahdollinen ikkuna,
    //eikä valinta saa vaihtua kesken päivän.
    const cases = {
      'nollahintaiset yö- ja iltatunnit': [0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0],
      'kaikki tunnit samanhintaisia': new Array(24).fill(1.1),
      'toistuva hintakuvio': [3.3, 1.1, 2.2, 3.3, 1.1, 2.2, 3.3, 1.1, 2.2, 3.3, 1.1, 2.2, 3.3, 1.1, 2.2, 3.3, 1.1, 2.2, 3.3, 1.1, 2.2, 3.3, 1.1, 2.2]
    };

    for (const name in cases) {
      for (const count of [2, 3, 4, 8, 12]) {
        test(`${name}, ${count} h`, () => {
          const prices = cases[name];
          const res = day({ mode: 2, m2: { p: 24, c: count, s: 1 } }, { price: (e, d) => prices[d.getHours()] });
          const on = res.map((v, h) => v ? h : -1).filter(h => h >= 0);

          assert.equal(on.length, count, 'tunteja on oikea määrä');
          assert.equal(on[on.length - 1] - on[0], count - 1, 'tunnit ovat peräkkäin: ' + on.join(','));

          //Halvin mahdollinen ikkuna
          let best = Infinity;
          for (let start = 0; start <= 24 - count; start++) {
            best = Math.min(best, prices.slice(start, start + count).reduce((a, b) => a + b, 0));
          }
          const cost = on.reduce((sum, h) => sum + prices[h], 0);
          assert.ok(Math.abs(cost - best) < 1e-9, `valitun ikkunan hinta ${cost}, halvin mahdollinen ${best}`);
        });
      }
    }
  });

  test('6 tunnin jaksot, 1 tunti kustakin', () => {
    assert.deepEqual(day({ mode: 2, m2: { p: 6, c: 1 } }), hours([2, 11, 13, 23]));
  });

  test('12 tunnin jaksot, 2 tuntia kustakin', () => {
    assert.deepEqual(day({ mode: 2, m2: { p: 12, c: 2 } }), hours([2, 3, 13, 23]));
  });

  test('oma jakso 08-16', () => {
    assert.deepEqual(day({ mode: 2, m2: { p: -1, ps: 8, pe: 16, c: 2 } }), hours([13, 14]));
  });

  test('kaksi omaa jaksoa 00-06 ja 12-24', () => {
    assert.deepEqual(
      day({ mode: 2, m2: { p: -2, ps: 0, pe: 6, c: 1, ps2: 12, pe2: 24, c2: 2 } }),
      hours([2, 13, 23])
    );
  });

  test('kaksi omaa jaksoa, ensimmäisestä 0 tuntia', () => {
    assert.deepEqual(
      day({ mode: 2, m2: { p: -2, ps: 0, pe: 6, c: 0, ps2: 12, pe2: 24, c2: 1 } }),
      hours([23])
    );
  });

  test('kaksi omaa jaksoa: peräkkäiset valitaan jaksoittain erikseen (s ja s2)', () => {
    //Jakso 1 (00-12): erilliset halvimmat tunnit 0, 2 ja 4 - halvin yhtenäinen kolmen tunnin jakso 4-6
    //Jakso 2 (12-24): erilliset halvimmat tunnit 12, 14 ja 16 - halvin yhtenäinen kolmen tunnin jakso 16-18
    const row = [1, 9, 1, 9, 2, 2, 2, 9, 9, 9, 9, 9];
    const price = (e, d) => row[d.getHours() % 12];
    const m2 = { p: -2, ps: 0, pe: 12, c: 3, ps2: 12, pe2: 24, c2: 3 };

    assert.deepEqual(day({ mode: 2, m2: { ...m2, s: 0, s2: 0 } }, { price }), hours([0, 2, 4, 12, 14, 16]), 'kumpikaan ei peräkkäin');
    assert.deepEqual(day({ mode: 2, m2: { ...m2, s: 1, s2: 0 } }, { price }), hours([4, 5, 6, 12, 14, 16]), 'vain jakso 1 peräkkäin');
    assert.deepEqual(day({ mode: 2, m2: { ...m2, s: 0, s2: 1 } }, { price }), hours([0, 2, 4, 16, 17, 18]), 'vain jakso 2 peräkkäin');
    assert.deepEqual(day({ mode: 2, m2: { ...m2, s: 1, s2: 1 } }, { price }), hours([4, 5, 6, 16, 17, 18]), 'molemmat peräkkäin');
  });

  test('vanhat asetukset ilman s2-kenttää: jakso 2 toimii kuten jakso 1 (kuten ennen)', () => {
    const row = [1, 9, 1, 9, 2, 2, 2, 9, 9, 9, 9, 9];
    const price = (e, d) => row[d.getHours() % 12];
    const m2 = { p: -2, ps: 0, pe: 12, c: 3, ps2: 12, pe2: 24, c2: 3 };

    assert.deepEqual(day({ mode: 2, m2: { ...m2, s: 1 } }, { price }), hours([4, 5, 6, 16, 17, 18]));
    assert.deepEqual(day({ mode: 2, m2: { ...m2, s: 0 } }, { price }), hours([0, 2, 4, 12, 14, 16]));

    //Puuttuva kenttä täydennetään ja tallennetaan laitteen asetuksiin
    const sim = boot({ start: DAY_BEFORE, inst: { mode: 2, m2: { ...m2, s: 1 } } });
    assert.equal(sim.cfg(0).m2.s2, 1);
    assert.equal(sim.status(0).ci.m2.s2, 1);
  });

  test('s2 ei vaikuta, kun omia jaksoja on yksi tai jaksot ovat tasavälisiä', () => {
    const row = [1, 9, 1, 9, 2, 2, 2, 9, 9, 9, 9, 9];
    const price = (e, d) => row[d.getHours() % 12];

    assert.deepEqual(day({ mode: 2, m2: { p: -1, ps: 0, pe: 12, c: 3, s: 0, s2: 1 } }, { price }), hours([0, 2, 4]));
    assert.deepEqual(day({ mode: 2, m2: { p: 12, c: 3, s: 0, s2: 1 } }, { price }), hours([0, 2, 4, 12, 14, 16]));
    assert.deepEqual(day({ mode: 2, m2: { p: 12, c: 3, s: 1, s2: 0 } }, { price }), hours([4, 5, 6, 16, 17, 18]));
  });

  test('aina päällä -raja lisää tunteja', () => {
    assert.deepEqual(day({ mode: 2, m2: { p: 24, c: 1, l: 2 } }), hours([1, 2, 3]));
  });

  test('aina päällä -raja "avg" ilman halvimpia tunteja', () => {
    assert.deepEqual(day({ mode: 2, m2: { p: 24, c: 0, l: 'avg' } }), hours(BELOW_AVG));
  });

  test('maksimihinta karsii halvimpia tunteja', () => {
    assert.deepEqual(day({ mode: 2, m2: { p: 24, c: 4, m: 1.5 } }), hours([2, 3]));
  });

  test('maksimihinta ohittaa aina päällä -rajan', () => {
    assert.deepEqual(day({ mode: 2, m2: { p: 24, c: 0, l: 3, m: 2 } }), hours([1, 2, 3]));
  });

  test('tuntimäärä rajataan jakson pituuteen', () => {
    assert.deepEqual(day({ mode: 2, m2: { p: -1, ps: 2, pe: 4, c: 10 } }), hours([2, 3]));
  });

  test('tilakoodit 4, 5, 6 ja 11', () => {
    const sim = boot({ start: '2026-10-06T02:10:00', inst: { mode: 2, m2: { p: 24, c: 2, l: 2, m: 1.2 } } });
    assert.equal(sim.status(0).si.st, 5, '02: halvimpia (1 c)');
    sim.advanceTo('2026-10-06T03:10:00');
    assert.equal(sim.status(0).si.st, 11, '03: halvimpia mutta yli maksimin (1.5 c)');
    sim.advanceTo('2026-10-06T08:10:00');
    assert.equal(sim.status(0).si.st, 4, '08: ei halvimpia');

    sim.saveConfig(0, { m2: { m: 999 } });
    sim.advanceTo('2026-10-07T01:10:00');
    assert.equal(sim.status(0).si.st, 6, '01: alle aina päällä -rajan (2 c)');
  });
});

describe('pakko-ohjatut tunnit', () => {
  test('tunti pakotetaan päälle ja pois', () => {
    //käsiohjaus päällä, tunti 10 pakotettu päälle ja 11 pois
    const res = day({ mode: 0, m0: { c: 1 }, f: mask([10, 11]), fc: mask([10]) });
    assert.deepEqual(res, hours([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]));
  });

  test('pakotus päälle ohittaa hintaohjauksen', () => {
    assert.deepEqual(day({ mode: 1, m1: { l: 1 }, f: mask([18]), fc: mask([18]) }), hours([2, 18]));
  });

  test('tilakoodi 10', () => {
    const sim = boot({ start: '2026-10-06T18:10:00', inst: { mode: 1, m1: { l: 1 }, f: mask([18]), fc: mask([18]) } });
    assert.equal(sim.status(0).si.st, 10);
    assert.equal(sim.relays[0], true);
  });
});

describe('käänteinen ohjaus', () => {
  test('lähtö on ohjauksen vastakohta', () => {
    const normal = day({ mode: 1, m1: { l: 5 } });
    const inverted = day({ mode: 1, m1: { l: 5 }, i: 1 });
    assert.deepEqual(inverted, normal.map(v => v ? 0 : 1));
  });
});

describe('tunnin ohjausminuutit', () => {
  test('lähtö on päällä vain tunnin ensimmäiset minuutit', () => {
    const sim = boot({ start: '2026-10-06T10:00:30', inst: { mode: 0, m0: { c: 1 }, m: 30 } });
    sim.advanceTo('2026-10-06T10:10:00');
    assert.equal(sim.relays[0], true, '10:10');

    sim.advanceTo('2026-10-06T10:29:30');
    assert.equal(sim.relays[0], true, '10:29');

    sim.advanceTo('2026-10-06T10:31:00');
    assert.equal(sim.relays[0], false, '10:31');
    assert.equal(sim.status(0).si.st, 13);

    sim.advanceTo('2026-10-06T10:59:00');
    assert.equal(sim.relays[0], false, '10:59');

    sim.advanceTo('2026-10-06T11:01:00');
    assert.equal(sim.relays[0], true, '11:01');
  });

  test('käänteisellä ohjauksella lähtö menee päälle minuuttien jälkeen', () => {
    const sim = boot({ start: '2026-10-06T10:00:30', inst: { mode: 0, m0: { c: 1 }, m: 15, i: 1 } });
    sim.advanceTo('2026-10-06T10:10:00');
    assert.equal(sim.relays[0], false);
    sim.advanceTo('2026-10-06T10:16:00');
    assert.equal(sim.relays[0], true);
  });

  test('ohjausminuutit ohittavat pakko-ohjatun tunnin', () => {
    const sim = boot({ start: '2026-10-06T10:00:30', inst: { mode: 0, m0: { c: 0 }, m: 20, f: mask([10]), fc: mask([10]) } });
    assert.equal(sim.relays[0], true);
    sim.advanceTo('2026-10-06T10:21:00');
    assert.equal(sim.relays[0], false);
  });
});

describe('käsiohjauksen tila HTTP-pyynnöllä (r=w, m0.c)', () => {
  const kvs = (sim, n = 1) => sim.cfg(n - 1);

  /** Laskee asetusten kirjoitukset laitteen muistiin */
  function countWrites(sim) {
    const counter = { n: 0 };
    const set = sim.kvs.set.bind(sim.kvs);
    sim.kvs.set = (key, value) => { counter.n++; return set(key, value); };
    return counter;
  }

  test('päälle ja pois: lähtö seuraa, tila tallentuu ja historiaan tulee käsiohjauksen rivi', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 0 } } });
    assert.equal(!!sim.relays[0], false);

    assert.equal(sim.get('r=w&i=0&m0.c=1').code, 204);
    sim.advance(5000);
    assert.equal(sim.relays[0], true);
    assert.equal(kvs(sim).m0.c, 1, 'tallennettu laitteen muistiin');
    assert.equal(sim.status(0).ci.m0.c, 1);
    assert.equal(sim.status(0).si.st, 1, 'selite: käsiohjaus');

    assert.equal(sim.get('r=w&i=0&m0.c=0').code, 204);
    sim.advance(5000);
    assert.equal(sim.relays[0], false);
    assert.equal(kvs(sim).m0.c, 0);
    assertAlive(sim);
  });

  test('tila säilyy skriptin uudelleenkäynnistyksen yli (toisin kuin pakko-ohjaus)', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 0 } } });
    sim.get('r=w&i=0&m0.c=1');
    sim.advance(5000);

    const again = boot({ start: '2026-10-05T11:00:00', kvs: Object.fromEntries(sim.kvs) });
    assert.equal(again.relays[0], true);
  });

  test('sama tila uudelleen ei kirjoita laitteen muistiin', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 1 } } });
    const writes = countWrites(sim);

    for (let i = 0; i < 5; i++) {
      sim.get('r=w&i=0&m0.c=1');
      sim.advance(5000);
    }
    assert.equal(writes.n, 0);
    assert.equal(sim.relays[0], true);

    sim.get('r=w&i=0&m0.c=0');
    sim.advance(5000);
    assert.equal(writes.n, 1, 'muutos kirjoitetaan kerran');
  });

  test('ohjaustapaa ei vaihdeta: hintaohjauksessa kytkin kääntyy, mutta lähtö seuraa hintaa', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 1, m1: { l: -999 }, m0: { c: 0 } } });
    assert.equal(!!sim.relays[0], false);

    sim.get('r=w&i=0&m0.c=1');
    sim.advance(5000);
    assert.equal(kvs(sim).m0.c, 1, 'käsiohjauksen tila on tallessa');
    assert.equal(kvs(sim).mode, 1, 'ohjaustapa on edelleen hintaraja');
    assert.equal(!!sim.relays[0], false, 'lähtö seuraa hintaa');

    //Kun ohjaustavaksi vaihdetaan käsiohjaus, tallennettu tila tulee voimaan
    sim.saveConfig(0, { mode: 0 });
    assert.equal(sim.relays[0], true);
  });

  test('muut asetukset säilyvät, eikä lisäosan muistissa tekemä muutos tallennu', () => {
    //Ensin täydelliset asetukset laitteen muistiin (ilman lisäosaa), sitten käynnistys lisäosan kanssa
    const first = boot({ start: '2026-10-05T09:00:00', inst: { mode: 0, m0: { c: 0 }, m2: { p: 6, c: 2 }, o: [0, 1], b: 30 } });
    const sim = boot({
      start: '2026-10-05T10:00:00',
      kvs: Object.fromEntries(first.kvs),
      user: 'function USER_CONFIG(inst, initialized) { if (inst == 0) { _.c.i[0].m2.c = 9; } }'
    });
    const before = kvs(sim);
    assert.equal(before.m2.c, 2, 'laitteen muistissa on käyttäjän asetus');
    assert.equal(sim.evaluate('_.c.i[0].m2.c'), 9, 'lisäosa on muuttanut arvoa muistissa');

    sim.get('r=w&i=0&m0.c=1');
    sim.advance(5000);
    const after = kvs(sim);
    assert.equal(after.m0.c, 1);
    assert.deepEqual(Object.assign({}, after, { m0: before.m0 }), before, 'vain käsiohjauksen tila muuttui');
    assert.equal(after.m2.c, 2);
  });

  test('toinen ohjaus: pyyntö koskee vain annettua ohjausta', () => {
    const sim = boot({
      start: '2026-10-05T10:00:00', common: { cnt: 2 }, inst: { mode: 0, m0: { c: 0 }, o: [0] },
      kvs: { 'porssi-2': { en: 1, mode: 0, m0: { c: 0 }, o: [1] } }
    });
    sim.get('r=w&i=1&m0.c=1');
    sim.advance(5000);
    assert.equal(!!sim.relays[0], false);
    assert.equal(sim.relays[1], true);
    assert.equal(kvs(sim, 1).m0.c, 0);
    assert.equal(kvs(sim, 2).m0.c, 1);
  });

  test('virheellinen pyyntö ei muuta mitään', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 0 } } });
    const writes = countWrites(sim);

    assert.equal(sim.get('r=w&i=0&m0.c=2').code, 400, 'tila pitää olla 1 tai 0');
    assert.equal(sim.get('r=w&i=0&m0.c=').code, 400, 'tila puuttuu');
    assert.equal(sim.get('r=w&i=5&m0.c=1').code, 400, 'ohjausta ei ole');
    //Aiempi erillinen pyyntö r=m on poistettu (se ei ehtinyt julkaistuun versioon)
    assert.equal(sim.get('r=m&i=0&c=1').code, 404);
    sim.advance(5000);
    assert.equal(writes.n, 0);
    assert.equal(!!sim.relays[0], false);
    assertAlive(sim);
  });

  test('rikkinäiset tallennetut asetukset: pyyntö ei kaada skriptiä eikä kirjoita mitään', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 0 } } });
    sim.kvs.set('porssisahko-1', '{rikki');
    const writes = countWrites(sim);

    sim.get('r=w&i=0&m0.c=1');
    sim.advance(5000);
    assert.equal(writes.n, 0);
    assertAlive(sim);
  });
});

describe('käsin annettu pakko-ohjaus', () => {
  test('kesto minuutteina (mi): laite laskee päättymisajan omasta kellostaan', () => {
    const sim = boot({ start: '2026-10-06T10:15:00', inst: { mode: 0, m0: { c: 0 } } });
    const t0 = sim.epoch();

    assert.equal(sim.get('r=f&i=0&mi=90&c=1').code, 204);
    sim.advance(2000);
    assert.equal(sim.relays[0], true);
    assert.equal(sim.status(0).si.st, 9);
    assert.equal(sim.status(0).si.fCmdTs, t0 + 90 * 60);

    sim.advanceTo('2026-10-06T11:44:00');
    assert.equal(sim.relays[0], true, 'vielä voimassa');
    sim.advanceTo('2026-10-06T11:46:30');
    assert.equal(sim.relays[0], false, 'päättynyt 90 minuutin kuluttua');
    assert.equal(sim.status(0).si.fCmdTs, 0);
  });

  test('mi=0 peruu pakko-ohjauksen', () => {
    const sim = boot({ start: '2026-10-06T10:15:00', inst: { mode: 0, m0: { c: 0 } } });
    sim.get('r=f&i=0&mi=60&c=1');
    sim.advance(2000);
    assert.equal(sim.relays[0], true);

    assert.equal(sim.get('r=f&i=0&mi=0&c=0').code, 204);
    sim.advance(2000);
    assert.equal(sim.relays[0], false);
    assert.equal(sim.status(0).si.fCmdTs, 0);
  });

  test('desimaalit kelpaavat: mi=0.5 on puoli minuuttia', () => {
    const sim = boot({ start: '2026-10-06T10:15:00', inst: { mode: 0, m0: { c: 0 } } });
    const t0 = sim.epoch();
    sim.get('r=f&i=0&mi=0.5&c=1');
    assert.equal(sim.status(0).si.fCmdTs, t0 + 30);
  });

  test('virheellinen mi (ei luku tai negatiivinen) jätetään huomiotta eikä voimassa olevaa muuteta', () => {
    const sim = boot({ start: '2026-10-06T10:15:00', inst: { mode: 0, m0: { c: 0 } } });
    sim.get('r=f&i=0&mi=60&c=1');
    sim.advance(2000);
    const ts = sim.status(0).si.fCmdTs;

    for (const m of ['abc', '-5']) {
      assert.equal(sim.get(`r=f&i=0&mi=${m}&c=0`).code, 204);
      sim.advance(2000);
      assert.equal(sim.status(0).si.fCmdTs, ts, `mi=${m}`);
      assert.equal(sim.status(0).si.fCmd, 1);
      assert.equal(sim.relays[0], true);
    }
    assertAlive(sim);
  });

  test('vanha tapa (ts) toimii ennallaan, ja jos molemmat on annettu, mi voittaa', () => {
    const sim = boot({ start: '2026-10-06T10:15:00', inst: { mode: 0, m0: { c: 0 } } });
    const t0 = sim.epoch();

    sim.get(`r=f&i=0&ts=${t0 + 7200}&c=1`);
    assert.equal(sim.status(0).si.fCmdTs, t0 + 7200);
    sim.advance(2000);
    assert.equal(sim.relays[0], true);

    sim.get('r=f&i=0&ts=0&c=0');
    sim.advance(2000);
    assert.equal(sim.relays[0], false, 'ts=0 peruu');

    const t1 = sim.epoch();
    sim.get(`r=f&i=0&ts=${t1 + 7200}&mi=10&c=1`);
    assert.equal(sim.status(0).si.fCmdTs, t1 + 600);
  });

  test('lähtö seuraa pakko-ohjausta heti, ei vasta seuraavalla silmukan kierroksella', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 0 } } });
    assert.equal(!!sim.relays[0], false);

    //Useita ajankohtia silmukan 10 sekunnin jaksossa
    for (const wait of [1000, 4000, 7000]) {
      sim.advance(wait);
      sim.get(`r=f&i=0&ts=${sim.epoch() + 3600}&c=1`);
      sim.advance(2000);
      assert.equal(sim.relays[0], true, `päälle 2 s kuluessa (odotus ${wait} ms)`);

      sim.get('r=f&i=0&ts=0&c=0');
      sim.advance(2000);
      assert.equal(sim.relays[0], false, `peruutus 2 s kuluessa (odotus ${wait} ms)`);
    }
    assertAlive(sim);
  });

  test('päälle kahdeksi tunniksi', () => {
    const sim = boot({ start: '2026-10-06T10:15:00', inst: { mode: 0, m0: { c: 0 } } });
    assert.equal(sim.relays[0], false);

    assert.equal(sim.force(0, 2, 1).code, 204);
    sim.settle();
    assert.equal(sim.relays[0], true);
    assert.equal(sim.status(0).si.st, 9);

    sim.advanceTo('2026-10-06T12:14:00');
    assert.equal(sim.relays[0], true, 'vielä voimassa');

    sim.advanceTo('2026-10-06T12:16:30');
    assert.equal(sim.relays[0], false, 'päättynyt');
    assert.equal(sim.status(0).si.st, 1);
    assert.equal(sim.status(0).si.fCmdTs, 0);
  });

  test('pois tunniksi', () => {
    const sim = boot({ start: '2026-10-06T10:15:00', inst: { mode: 0, m0: { c: 1 } } });
    sim.force(0, 1, 0);
    sim.settle();
    assert.equal(sim.relays[0], false);
    sim.advanceTo('2026-10-06T11:16:30');
    assert.equal(sim.relays[0], true);
  });

  test('peruminen (0 tuntia)', () => {
    const sim = boot({ start: '2026-10-06T10:15:00', inst: { mode: 0, m0: { c: 0 } } });
    sim.force(0, 5, 1);
    sim.settle();
    assert.equal(sim.relays[0], true);
    sim.force(0, 0, 0);
    sim.settle();
    assert.equal(sim.relays[0], false);
  });

  test('ohittaa ohjausminuutit', () => {
    const sim = boot({ start: '2026-10-06T10:40:00', inst: { mode: 0, m0: { c: 1 }, m: 30 } });
    assert.equal(sim.relays[0], false);
    sim.force(0, 1, 1);
    sim.settle();
    assert.equal(sim.relays[0], true);
  });
});

describe('vikatilanteet', () => {
  test('varmuustunnit kun hintoja ei saada', () => {
    const sim = boot({ start: DAY_BEFORE, inst: { mode: 1, m1: { l: 999 }, b: mask([3, 4]) }, settle: false });
    sim.net.mode = 'error';
    assert.deepEqual(runDay(sim, DAY), hours([3, 4]));
    assert.equal(sim.status(0).si.st, 7);
  });

  test('varmuustunteja ei käytetä nopeiden uusintayritysten aikana: kolmas haku onnistuu -> yksi kytkentä hinnan mukaan', () => {
    //Käynnistys ilman hintoja, varmuustunti 10 päällä; kaksi ensimmäistä hakua epäonnistuu
    const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 1, m1: { l: 999 }, b: 1 << 10 }, settle: false });
    sim.net.mode = 'error';
    sim.advance(7000);
    assertAlive(sim);
    assert.equal(sim.status(0).s.errCnt, 2, 'kaksi epäonnistumista');
    assert.equal(sim.switchLog.length, 0, 'lähtöä ei ole kirjoitettu');

    sim.net.mode = 'ok';
    sim.advance(15000);
    assertAlive(sim);
    assert.equal(sim.status(0).si.st, 2, 'ohjaus hinnan mukaan');
    assert.equal(sim.switchLog.length, 1, 'yksi kirjoitus, ei varmuustuntien kautta');
  });

  test('varmuustunnit otetaan käyttöön kolmen epäonnistuneen haun jälkeen', () => {
    const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 1, m1: { l: 999 }, b: 1 << 10 }, settle: false });
    sim.net.mode = 'error';
    sim.advance(7000);
    assert.equal(sim.switchLog.length, 0, 'ei vielä');
    sim.advance(20000);
    assertAlive(sim);
    assert.equal(sim.status(0).s.errCnt, 3);
    assert.equal(sim.status(0).si.st, 7, 'varmuustunnit');
    assert.equal(sim.relays[0], true);
  });

  test('hintakatko ilman tämän päivän hintoja: lähtö kirjoitetaan vain varmuustuntien alkaessa ja tasatunneilla', () => {
    //Alkuperäisen projektin issue #37: jokainen epäonnistunut haku ajoi logiikan uudelleen,
    //joten asetuksella "aina tarkistaessa" lähtö kirjoitettiin koko katkon ajan muutaman minuutin välein
    const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 1, m1: { l: 999 }, b: (1 << 10) | (1 << 11), oc: 0 }, settle: false });
    sim.net.mode = 'error';
    sim.advanceTo('2026-10-06T12:01:00');
    assertAlive(sim);

    assert.ok(sim.status(0).s.errCnt > 6, 'katko jatkui koko ajan');
    assert.equal(sim.status(0).si.st, 7, 'varmuustunnit');

    const times = sim.switchLog.map(w => new Date(w.t));
    const label = times.map(d => d.toTimeString().slice(0, 8)).join(', ');
    assert.equal(times.length, 3, 'kirjoitukset: ' + label);
    assert.ok(times[0] < new Date('2026-10-06T10:02:00'), 'varmuustunnit alkavat: ' + label);
    assert.ok(times.slice(1).every(d => d.getMinutes() == 0 && d.getSeconds() < 15), 'muut tasatunneilla: ' + label);
  });

  test('hintakatko ilman tämän päivän hintoja: varmuustuntien vaihtuminen seuraa tasatunteja', () => {
    //Varmuustunti 10 päällä, 11 pois: lähtö kääntyy pois klo 11, vaikka logiikkaa ei ajeta epäonnistuneiden hakujen jälkeen
    const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 1, m1: { l: 999 }, b: 1 << 10 }, settle: false });
    sim.net.mode = 'error';
    sim.advanceTo('2026-10-06T10:59:00');
    assert.equal(sim.relays[0], true, 'varmuustunti 10');
    sim.advanceTo('2026-10-06T11:01:00');
    assertAlive(sim);
    assert.equal(sim.relays[0], false, 'tunti 11 ei varmuustunti');
    assert.equal(sim.status(0).si.st, 7);
  });

  test('hätätilaohjaus päällä kun kellonaika ei ole tiedossa', () => {
    const sim = boot({ timeSynced: false, inst: { mode: 1, m1: { l: 999 }, e: 1 } });
    assert.equal(sim.relays[0], true);
    assert.equal(sim.status(0).si.st, 8);
    assert.equal(sim.fetchCount(), 0, 'hintoja ei haeta ilman kellonaikaa');
  });

  test('hätätilaohjaus pois kun kellonaika ei ole tiedossa', () => {
    const sim = boot({ timeSynced: false, inst: { mode: 1, m1: { l: 999 }, e: 0 } });
    assert.equal(sim.relays[0], false);
    assert.equal(sim.status(0).si.st, 8);
  });

  test('lämmittelyaika: heti käynnistyksen jälkeen lähtöä ei kirjoiteta ennen kellonaikaa', () => {
    //Laite on käynnistynyt 5 s sitten, kellonaikaa ei vielä ole, hätätila-asetus "päällä"
    const sim = boot({ timeSynced: false, uptime: 5, inst: { mode: 1, m1: { l: 999 }, e: 1 }, settle: false });
    sim.advance(20e3);
    assertAlive(sim);
    assert.equal(sim.switchLog.length, 0, 'lähtöä ei ole kirjoitettu');
    assert.equal(sim.status(0).si.st, 0, 'tila: käynnistetään');

    //Kello saadaan 20 s käynnistyksestä -> ohjaus suoraan hinnan mukaan, yksi kirjoitus
    sim.timeSynced = true;
    sim.advance(30e3);
    assertAlive(sim);
    assert.equal(sim.relays[0], true);
    assert.equal(sim.status(0).si.st, 2);
    assert.equal(sim.switchLog.length, 1, 'vain yksi kirjoitus, ei hätätilan kautta');
    //Historiaan ei tule hätätilariviä
    const raw = Buffer.from(sim.get('r=h&i=0').json, 'base64');
    const states = []; for (let i = 0; i < raw.length; i += 4) states.push(raw[i + 3] & 15);
    assert.deepEqual(states, [2]);
  });

  test('lämmittelyaika: ilman kellonaikaa hätätilaohjaus alkaa 180 s käynnistyksestä', () => {
    const sim = boot({ timeSynced: false, uptime: 5, inst: { mode: 1, m1: { l: 999 }, e: 1 }, settle: false });
    sim.advance(165e3);
    assert.equal(sim.switchLog.length, 0, 'ei vielä');
    sim.advance(30e3);
    assertAlive(sim);
    assert.equal(sim.relays[0], true, 'hätätila-asetuksen mukaan');
    assert.equal(sim.status(0).si.st, 8);
  });

  test('lämmittelyaika ei koske käsiohjausta', () => {
    const sim = boot({ timeSynced: false, uptime: 5, inst: { mode: 0, m0: { c: 1 } }, settle: false });
    sim.advance(15e3);
    assertAlive(sim);
    assert.equal(sim.relays[0], true, 'käsiohjaus kirjoitetaan heti');
  });

  test('normaali ohjaus alkaa kun kellonaika saadaan', () => {
    const sim = boot({ timeSynced: false, inst: { mode: 1, m1: { l: 999 }, e: 0 } });
    sim.timeSynced = true;
    sim.settle();
    assert.equal(sim.relays[0], true);
    assert.equal(sim.status(0).si.st, 2);
  });

  test('epäonnistunut lähdön ohjaus yritetään uudelleen', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 } }, settle: false });
    sim.switchFail = true;
    sim.settle(60000);
    assertAlive(sim);
    assert.equal(sim.relays[0], undefined);
    assert.equal(sim.status(0).si.cmd, -1, 'ohjausta ei merkitä tehdyksi');
    assert.ok(sim.switchLog.length >= 3, 'useita yrityksiä');

    sim.switchFail = false;
    sim.settle();
    assert.equal(sim.relays[0], true);
    assert.equal(sim.status(0).si.cmd, 1);
  });

  test('olematon lähtö: ei jatkuvaa uudelleenyritystä ja tieto käyttöliittymälle', () => {
    const sim = boot({ start: '2026-10-06T10:10:00', inst: { mode: 0, m0: { c: 1 }, o: [7] } });
    assert.equal(sim.status(0).si.oe, 7);
    assert.equal(sim.status(0).si.cmd, 1);
    assert.ok(sim.status(0).si.chkTs > 0, 'logiikka merkitään ajetuksi');

    //Lähtöä yritetään vain logiikan ajon yhteydessä eli kerran tunnissa
    sim.advanceTo('2026-10-06T13:10:00');
    assertAlive(sim);
    assert.equal(sim.switchLog.length, 4);
    assert.equal(sim.logLines().filter(l => l.includes('setting output 7 failed')).length, 4);
  });

  test('olematon lähtö yhdessä ohjauksessa ei estä muita ohjauksia', () => {
    const sim = boot({
      start: '2026-10-06T10:10:00',
      inst: { mode: 0, m0: { c: 1 }, o: [7] },
      kvs: {
        'porssi-2': { en: 1, mode: 0, m0: { c: 1 }, o: [1] },
        'porssi-3': { en: 1, mode: 1, m1: { l: 8 }, o: [2] }
      }
    });
    assert.equal(sim.relays[1], true);
    assert.equal(sim.relays[2], false, '10:10 hinta 9 c > raja 8 c');
    assert.equal(sim.status(1).si.oe, -1);

    sim.advanceTo('2026-10-06T11:10:00');
    assert.equal(sim.relays[2], true, '11:10 hinta 7 c');
  });

  test('olemattoman lähdön virhe poistuu, kun asetus korjataan', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 }, o: [0, 7] } });
    assert.equal(sim.relays[0], true, 'olemassa oleva lähtö ohjataan');
    assert.equal(sim.status(0).si.oe, 7);

    sim.saveConfig(0, { o: [0] });
    assert.equal(sim.status(0).si.oe, -1);
  });

  test('ohjaukset ajetaan aina samassa järjestyksessä, kun kaikki toimii', () => {
    //Lähtöjen ohjaamat laitteet voivat riippua toisistaan, joten järjestys #1, #2, #3 ei saa vaihdella
    const sim = boot({
      start: '2026-10-06T10:10:00',
      inst: { mode: 0, m0: { c: 1 }, o: [0] },
      kvs: {
        'porssi-2': { en: 1, mode: 0, m0: { c: 1 }, o: [1] },
        'porssi-3': { en: 1, mode: 0, m0: { c: 1 }, o: [2] }
      }
    });
    const order = (from) => sim.switchLog.slice(from).map(s => s.id);
    assert.deepEqual(order(0), [0, 1, 2]);

    //Yksittäisiä ajoja kesken tunnin: asetusten tallennus, pakko-ohjaus ja sen päättyminen
    let n = sim.switchLog.length;
    sim.saveConfig(1, { m0: { c: 0 } });
    sim.force(2, 0.1, 0);
    sim.settle();
    sim.advanceTo('2026-10-06T10:40:00');
    sim.force(0, 0.05, 0);
    sim.advanceTo('2026-10-06T10:55:00');

    //Seuraavat tasatunnit: järjestys on edelleen #1, #2, #3
    for (const time of ['2026-10-06T11:01:00', '2026-10-06T12:01:00', '2026-10-06T13:01:00']) {
      n = sim.switchLog.length;
      sim.advanceTo(time);
      assert.deepEqual(order(n), [0, 1, 2], time);
    }
  });

  test('epäonnistuneen ohjauksen jälkeen järjestys palaa ennalleen', () => {
    const sim = boot({
      start: '2026-10-06T10:10:00',
      inst: { mode: 0, m0: { c: 1 }, o: [0] },
      kvs: { 'porssi-2': { en: 1, mode: 0, m0: { c: 1 }, o: [1] }, 'porssi-3': { en: 1, mode: 0, m0: { c: 1 }, o: [2] } },
      settle: false
    });
    sim.switchFailIds = [1];
    sim.advanceTo('2026-10-06T10:50:00');
    assert.equal(sim.relays[2], true, 'ohjaus #3 ajetaan, vaikka #2 epäonnistuu');

    sim.switchFailIds = [];
    sim.advanceTo('2026-10-06T10:55:00');
    assert.equal(sim.relays[1], true);

    let n = sim.switchLog.length;
    sim.advanceTo('2026-10-06T11:01:00');
    assert.deepEqual(sim.switchLog.slice(n).map(s => s.id), [0, 1, 2]);
  });

  test('jatkuvasti epäonnistuva lähtö ei estä muita ohjauksia', () => {
    //Muu virhe kuin olematon lähtö: yritetään uudelleen, mutta muut ohjaukset saavat vuoronsa
    const sim = boot({
      start: '2026-10-06T10:10:00',
      inst: { mode: 0, m0: { c: 1 }, o: [0] },
      kvs: { 'porssi-2': { en: 1, mode: 1, m1: { l: 8 }, o: [1] } },
      settle: false
    });
    sim.switchFailIds = [0];
    sim.settle(60000);
    assertAlive(sim);

    assert.equal(sim.relays[0], undefined);
    assert.ok(sim.switchLog.filter(s => s.id === 0).length >= 3, 'epäonnistunutta lähtöä yritetään uudelleen');
    assert.equal(sim.status(0).si.cmd, -1);
    assert.equal(sim.relays[1], false, 'ohjaus #2 ajetaan');

    sim.advanceTo('2026-10-06T11:10:00');
    assert.equal(sim.relays[1], true, 'ohjaus #2 toimii tunnin vaihtuessa');

    //Vika poistuu -> ohjaus #1 palautuu
    sim.switchFailIds = [];
    sim.settle();
    assert.equal(sim.relays[0], true);
  });

  test('olematon lähtö ei kaada skriptiä', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 }, o: [0, 7] } });
    sim.settle(60000);
    assertAlive(sim);
    assert.equal(sim.relays[0], true, 'olemassa oleva lähtö ohjataan silti');
  });
});

describe('lähdöt', () => {
  test('useita lähtöjä samalla ohjauksella', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 }, o: [0, 2] } });
    assert.deepEqual(sim.relays, { 0: true, 2: true });
  });

  test('oc=0: lähtö kirjoitetaan joka tunti', () => {
    const sim = boot({ start: '2026-10-06T10:10:00', inst: { mode: 0, m0: { c: 1 }, oc: 0 } });
    sim.advanceTo('2026-10-06T14:10:00');
    assert.equal(sim.switchLog.length, 5);
  });

  test('oc=1: lähtö kirjoitetaan vain tilan muuttuessa', () => {
    const sim = boot({ start: '2026-10-06T10:10:00', inst: { mode: 0, m0: { c: 1 }, oc: 1 } });
    sim.advanceTo('2026-10-06T14:10:00');
    assert.equal(sim.switchLog.length, 1);

    //Logiikka ajetaan silti joka tunti
    const chk = new Date(sim.status(0).si.chkTs * 1000);
    assert.equal(chk.getHours(), 14);
  });

  test('ei käytössä oleva ohjaus ei koske lähtöihin', () => {
    const sim = boot({ inst: { en: 0, mode: 0, m0: { c: 1 } } });
    sim.advance(3 * 3600e3);
    assert.equal(sim.switchLog.length, 0);
  });
});

describe('kolme ohjausta', () => {
  test('ohjaukset toimivat toisistaan riippumatta', () => {
    const sim = boot({
      start: DAY_BEFORE,
      inst: { mode: 1, m1: { l: 2 }, o: [0] },
      kvs: {
        'porssi-2': { en: 1, mode: 2, m2: { p: 24, c: 2 }, o: [1] },
        'porssi-3': { en: 1, mode: 0, m0: { c: 1 }, o: [2], i: 1 }
      }
    });

    let res = [[], [], []];
    for (let h = 0; h < 24; h++) {
      sim.advanceTo(`${DAY}T${String(h).padStart(2, '0')}:30:00`);
      [0, 1, 2].forEach(o => res[o].push(sim.relays[o] ? 1 : 0));
    }

    assertAlive(sim);
    assert.deepEqual(res[0], hours([1, 2, 3]));
    assert.deepEqual(res[1], hours([2, 3]));
    assert.deepEqual(res[2], hours([]));
    assert.equal(sim.status(0).s.enCnt, 3);
  });
});

describe('historia', () => {
  test('rivi tallennetaan vain ohjauksen muuttuessa', () => {
    const sim = boot({ start: DAY_BEFORE, inst: { mode: 2, m2: { p: 24, c: 4 } } });
    runDay(sim, DAY);

    //23:50 pois (käynnistys), 01:00 päälle, 05:00 pois
    const hist = sim.history(0);
    assert.deepEqual(hist.map(r => r[1]), [0, 1, 0]);
    assert.deepEqual(hist.map(r => r[2]), [4, 5, 4]);
    assert.equal(new Date(hist[1][0] * 1000).getHours(), 1);
    assert.equal(new Date(hist[2][0] * 1000).getHours(), 5);
  });

  test('pituus on enintään 24 riviä yhdellä ohjauksella', () => {
    //Joka toinen tunti päällä -> ohjaus muuttuu joka tunti
    const price = (e, d) => d.getHours() % 2;
    const sim = boot({ start: DAY_BEFORE, inst: { mode: 1, m1: { l: 0 } }, price });
    runDay(sim, DAY);
    runDay(sim, '2026-10-07');

    const hist = sim.history(0);
    assert.equal(hist.length, 24);
    assert.equal(new Date(hist[23][0] * 1000).getHours(), 23, 'uusin rivi on viimeisenä');
  });

  test('pituus jaetaan käytössä olevien ohjausten kesken', () => {
    const price = (e, d) => d.getHours() % 2;
    const sim = boot({
      start: DAY_BEFORE,
      inst: { mode: 1, m1: { l: 0 } },
      kvs: { 'porssi-2': { en: 1, mode: 1, m1: { l: 0 }, o: [1] } },
      price
    });
    runDay(sim, DAY);

    assert.equal(sim.history(0).length, 12);
    assert.equal(sim.history(1).length, 12);
  });

  test('historia tyhjenee kun ohjaus poistetaan käytöstä', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 } } });
    assert.equal(sim.history(0).length, 1);
    sim.saveConfig(0, { en: 0 });
    assert.equal(sim.history(0).length, 0);
  });

  test('rivi on pakattu neljään tavuun minuutin tarkkuudella', () => {
    const sim = boot({ start: '2026-10-06T10:17:42', inst: { mode: 0, m0: { c: 1 } } });

    assert.equal(Buffer.from(sim.historyRaw(0), 'base64').length, 4);
    assert.equal(sim.evaluate('typeof _.h[0]'), 'string');
    assert.equal(new Date(sim.history(0)[0][0] * 1000).toISOString(), new Date('2026-10-06T10:17:00').toISOString());
  });

  for (const hist of [0, 48, 72, 96]) {
    test(`historian pituus ${hist} riviä`, () => {
      //Joka toinen vartti päällä -> ohjaus muuttuu 96 kertaa päivässä
      const price = (e, d) => (d.getMinutes() / 15) % 2;
      const sim = boot({ start: DAY_BEFORE, common: { hist }, inst: { mode: 1, m1: { l: 0 }, q: 1 }, price });
      for (const day of ['2026-10-06', '2026-10-07']) {
        for (let h = 0; h < 24; h++) {
          sim.advanceTo(`${day}T${String(h).padStart(2, '0')}:59:00`);
        }
      }
      assertAlive(sim);

      const rows = sim.history(0);
      assert.equal(rows.length, hist);
      if (hist) {
        //Uusin rivi on viimeisenä ja rivit ovat aikajärjestyksessä
        assert.equal(new Date(rows[hist - 1][0] * 1000).getHours(), 23);
        assert.ok(rows.every((r, i) => i === 0 || r[0] > rows[i - 1][0]));
        assert.ok(rows.every((r, i) => i === 0 || r[1] !== rows[i - 1][1]), 'ohjaus vaihtuu joka rivillä');
      }
    });
  }

  test('pituus jaetaan käytössä olevien ohjausten kesken (96 riviä, 3 ohjausta)', () => {
    const price = (e, d) => (d.getMinutes() / 15) % 2;
    const inst = (o) => ({ en: 1, mode: 1, m1: { l: 0 }, q: 1, o: [o] });
    const sim = boot({ start: DAY_BEFORE, common: { hist: 96 }, inst: inst(0), kvs: { 'porssi-2': inst(1), 'porssi-3': inst(2) }, price });
    for (let h = 0; h < 24; h++) {
      sim.advanceTo(`${DAY}T${String(h).padStart(2, '0')}:59:00`);
    }
    assert.deepEqual([0, 1, 2].map(i => sim.history(i).length), [32, 32, 32]);
  });

  test('pituuden pienentäminen poistaa vanhimmat rivit heti', () => {
    const price = (e, d) => d.getHours() % 2;
    const sim = boot({ start: DAY_BEFORE, common: { hist: 48 }, inst: { mode: 1, m1: { l: 0 } }, price });
    runDay(sim, DAY);
    runDay(sim, '2026-10-07');
    assert.equal(sim.history(0).length, 48);
    const newest = sim.history(0)[47];

    sim.saveConfig(0, {}, { hist: 24 });
    assert.equal(sim.history(0).length, 24);
    assert.deepEqual(sim.history(0)[23], newest, 'uusimmat rivit säilyvät');

    sim.saveConfig(0, {}, { hist: 0 });
    assert.equal(sim.history(0).length, 0);
    sim.advance(3 * 3600e3);
    assert.equal(sim.history(0).length, 0, 'historiaa ei kerätä');
  });

  for (const value of [-1, 97, 1000, 'abc', null]) {
    test(`virheellinen historian pituus (${JSON.stringify(value)}) korvataan oletuksella 24`, () => {
      const sim = boot({ common: { hist: value } });
      assert.equal(sim.status(0).c.hist, 24);
      assert.equal(sim.cfg(-1).hist, 24);
    });
  }

  test('vanha asennus ilman asetusta saa 24 riviä', () => {
    const sim = boot();
    assert.equal(sim.status(0).c.hist, 24);
  });
});
