/**
 * 30 minuutin hintatarkkuus (asetus q = 2) ja murto-osatunnit tuntimäärässä.
 *
 * Laskentayksikkö on puoli tuntia (kahden vartin keskiarvo, aina xx:00 tai xx:30 alkaen):
 * tuntimäärä 1,5 tarkoittaa kolmea puolituntista ja logiikka ajetaan puolen tunnin välein.
 * Varttitilassa (q = 1) tuntimäärän voi antaa 0,25 h tarkkuudella, tuntitilassa kokonaisina tunteina.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { boot, assertAlive, runDay, runDaySlots, slots, range, onTimes, hours, mask, near, DAY_BEFORE, DAY } = require('./helpers');

/** Hintafunktio: kaikki jaksot maksavat base, paitsi luetellut (kellonaika -> hinta) */
const priced = (base, special) => (e, d) => {
  const key = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return special[key] ?? base;
};

/** Käynnistää edellisenä iltana ja palauttaa päivän vartit, joilla lähtö on päällä */
function day(inst, opts = {}) {
  const sim = boot(Object.assign({ start: DAY_BEFORE, inst: Object.assign({ q: 2 }, inst) }, opts));
  return runDaySlots(sim, DAY);
}

const same = (actual, expected) => assert.equal(onTimes(actual), onTimes(expected));

describe('30 min tarkkuus: hinnat', () => {
  test('hinta on kahden vartin keskiarvo', () => {
    const price = priced(10, { '10:00': 2, '10:15': 8, '10:30': 20, '10:45': 30 });
    const sim = boot({ start: '2026-10-06T09:00:00', inst: { mode: 1, m1: { l: 0 }, q: 2 }, price });
    const rows = sim.halfRows(0);

    assert.equal(rows.length, 48);
    near(rows[20][1], 5);
    near(rows[21][1], 25);
    near(rows[22][1], 10);
    assert.equal(rows[21][0], Math.floor(new Date('2026-10-06T10:30:00').getTime() / 1000));
  });

  test('ALV ja siirtohinta lisätään kuten tuntihintoihin', () => {
    const sim = boot({ start: '2026-10-06T09:00:00', common: { vat: 25.5, day: 4, night: 1.5 }, price: priced(10, { '03:00': -2, '03:15': -4 }) });
    const rows = sim.halfRows(0);
    near(rows[6][1], -3 + 1.5, 'negatiiviseen hintaan ei lisätä veroa');
    near(rows[7][1], 10 * 1.255 + 1.5, 'yö');
    near(rows[14][1], 10 * 1.255 + 4, 'päivä');
  });
});

describe('30 min tarkkuus: hintaraja', () => {
  test('verrataan puolen tunnin keskiarvoa', () => {
    //Tunti 10: vartit 2, 4, 2, 8 -> puolituntiset 3 ja 5, tunti 5. Raja 4.
    const price = priced(10, { '10:00': 2, '10:15': 4, '10:30': 2, '10:45': 8 });
    same(day({ mode: 1, m1: { l: 4 } }, { price }), slots(range('10:00', '10:30')));

    //Varttitilassa ohjaus seuraisi jokaista varttia
    same(day({ mode: 1, m1: { l: 4 }, q: 1 }, { price }), slots(['10:00', '10:15', '10:30']));
  });

  test('logiikka ajetaan puolen tunnin välein', () => {
    const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 1, m1: { l: 4 }, q: 2 }, price: priced(10, { '10:00': 2, '10:15': 2 }) });
    const chk = () => sim.status(0).si.chkTs;
    const first = chk();

    sim.advanceTo('2026-10-06T10:16:00');
    assert.equal(chk(), first, 'ei ajoa vartin vaihtuessa');
    assert.equal(sim.status(0).si.st, 2);

    sim.advanceTo('2026-10-06T10:31:00');
    assert.notEqual(chk(), first);
    assert.equal(sim.status(0).si.st, 3);
    assert.equal(sim.relays[0], false);
  });

  test('ohjausminuutit eivät ole käytössä', () => {
    const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 1, m1: { l: 999 }, m: 10, q: 2 }, price: () => 5 });
    sim.advanceTo('2026-10-06T10:25:00');
    assert.equal(sim.relays[0], true);
  });
});

describe('30 min tarkkuus: jakson halvimmat', () => {
  test('1,5 tuntia = kolme halvinta puolituntista', () => {
    const price = priced(10, { '02:30': 1, '02:45': 1, '07:00': 2, '07:15': 2, '13:30': 3, '13:45': 3, '20:00': 4, '20:15': 4 });
    same(day({ mode: 2, m2: { p: 24, c: 1.5 } }, { price }),
      slots([...range('02:30', '03:00'), ...range('07:00', '07:30'), ...range('13:30', '14:00')]));
  });

  test('yksittäinen halpa vartti ei riitä, puolituntisen keskiarvo ratkaisee', () => {
    //05:15 on päivän halvin vartti, mutta puolituntinen 05:00-05:30 (ka. 5,5) on kalliimpi kuin 12:00-12:30 (ka. 4)
    const price = priced(10, { '05:15': 1, '12:00': 4, '12:15': 4 });
    same(day({ mode: 2, m2: { p: 24, c: 0.5 } }, { price }), slots(range('12:00', '12:30')));
  });

  test('ohjaus alkaa aina tasalta tai puolelta', () => {
    //Halvin yhtenäinen tunti olisi 10:15-11:15, mutta 30 min tarkkuudella valitaan kaksi halvinta puolituntista
    const price = priced(10, { '10:15': 1, '10:30': 1, '10:45': 1, '11:00': 1 });
    same(day({ mode: 2, m2: { p: 24, c: 1 } }, { price }), slots(range('10:30', '11:00').concat(range('10:00', '10:30'))));
  });

  test('peräkkäiset: 1,5 tuntia yhtenäisenä', () => {
    const price = priced(10, { '03:00': 1, '03:15': 1, '14:30': 3, '14:45': 3, '15:00': 3, '15:15': 3, '15:30': 3, '15:45': 3 });
    same(day({ mode: 2, m2: { p: 24, c: 1.5, s: 1 } }, { price }), slots(range('14:30', '16:00')));
  });

  test('jaksot: 0,5 tuntia jokaisesta 6 tunnin jaksosta', () => {
    const price = priced(10, { '01:30': 1, '01:45': 1, '08:00': 1, '08:15': 1, '17:30': 1, '17:45': 1, '23:00': 1, '23:15': 1 });
    same(day({ mode: 2, m2: { p: 6, c: 0.5 } }, { price }),
      slots([...range('01:30', '02:00'), ...range('08:00', '08:30'), ...range('17:30', '18:00'), ...range('23:00', '23:30')]));
  });

  test('oma jakso ja tuntimäärä 2,5', () => {
    const price = (e, d) => d.getHours() + d.getMinutes() / 100;
    same(day({ mode: 2, m2: { p: -1, ps: 8, pe: 16, c: 2.5 } }, { price }), slots(range('08:00', '10:30')));
  });

  test('varmuustunnit ja pakko-ohjatut tunnit ovat kokonaisia tunteja', () => {
    same(day({ mode: 2, m2: { p: 24, c: 0 }, f: mask([4]), fc: mask([4]) }, { price: () => 5 }), slots(range('04:00', '05:00')));
  });
});

describe('murto-osatunnit muissa tarkkuuksissa', () => {
  test('varttitila: 0,75 tuntia = kolme varttia', () => {
    const price = priced(10, { '02:15': 1, '07:45': 2, '13:00': 3, '23:30': 4 });
    same(day({ mode: 2, m2: { p: 24, c: 0.75 }, q: 1 }, { price }), slots(['02:15', '07:45', '13:00']));
  });

  test('varttitila: 1,25 tuntia = viisi varttia peräkkäin', () => {
    const price = (e, d) => Math.abs(d.getHours() * 60 + d.getMinutes() - 615);
    same(day({ mode: 2, m2: { p: 24, c: 1.25, s: 1 }, q: 1 }, { price }), slots(range('09:45', '11:00')));
  });

  test('varttitila: 0,25 tuntia jaksossa', () => {
    const price = priced(10, { '03:45': 1, '15:30': 1 });
    same(day({ mode: 2, m2: { p: 12, c: 0.25 }, q: 1 }, { price }), slots(['03:45', '15:30']));
  });

  test('30 min tila: 0,25 h tarkkuudella annettu arvo pyöristyy puolituntisiin', () => {
    const price = (e, d) => d.getHours() + d.getMinutes() / 100;
    same(day({ mode: 2, m2: { p: 24, c: 1.2 } }, { price }), slots(range('00:00', '01:00')));
    same(day({ mode: 2, m2: { p: 24, c: 1.25 } }, { price }), slots(range('00:00', '01:30')));
  });

  test('tuntitila: murto-osa pyöristyy kokonaisiin tunteihin', () => {
    const price = (e, d) => d.getHours();
    let sim = boot({ start: DAY_BEFORE, inst: { mode: 2, m2: { p: 24, c: 1.5 } }, price });
    assert.deepEqual(runDay(sim, DAY), hours([0, 1]));
    sim = boot({ start: DAY_BEFORE, inst: { mode: 2, m2: { p: 24, c: 2.4 } }, price });
    assert.deepEqual(runDay(sim, DAY), hours([0, 1]));
  });
});

describe('30 min tarkkuus: erikoistilanteet', () => {
  test('tuntiresoluution hintadatalla toimitaan tuntihinnoilla', () => {
    const sim = boot({ start: DAY_BEFORE, inst: { mode: 2, m2: { p: 24, c: 1.5 }, q: 2 }, resolution: 60, price: (e, d) => d.getHours() });
    //1,5 h -> 2 tuntia (pyöristys kokonaisiin yksiköihin)
    assert.deepEqual(runDay(sim, DAY), hours([0, 1]));
  });

  test('ohjaukset eri tarkkuuksilla rinnakkain', () => {
    const price = priced(10, { '10:00': 2, '10:15': 8, '10:30': 9, '10:45': 9 });
    const sim = boot({
      start: DAY_BEFORE, price,
      inst: { mode: 1, m1: { l: 6 }, q: 0, o: [0] },
      kvs: {
        'porssi-2': { en: 1, mode: 1, m1: { l: 6 }, q: 1, o: [1] },
        'porssi-3': { en: 1, mode: 1, m1: { l: 6 }, q: 2, o: [2] }
      }
    });

    //tunti: ka. 7 -> pois, vartti: vain 10:00, 30 min: 10:00-10:30 (ka. 5)
    same(runDaySlots(sim, DAY, 0), slots([]));
    const sim2 = boot({ start: DAY_BEFORE, price, inst: { en: 0 }, kvs: { 'porssi-2': { en: 1, mode: 1, m1: { l: 6 }, q: 1, o: [1] } } });
    same(runDaySlots(sim2, DAY, 1), slots(['10:00']));
    const sim3 = boot({ start: DAY_BEFORE, price, inst: { en: 0 }, kvs: { 'porssi-3': { en: 1, mode: 1, m1: { l: 6 }, q: 2, o: [2] } } });
    same(runDaySlots(sim3, DAY, 2), slots(range('10:00', '10:30')));
  });

  test('vuorokauden vaihde: huomisen hinnat siirtyvät ja ohjaus jatkuu', () => {
    const price = (e, d) => d.getDate() === 6 && d.getHours() === 0 && d.getMinutes() < 30 ? 1 : 10;
    const sim = boot({ start: '2026-10-05T23:40:00', inst: { mode: 1, m1: { l: 5 }, q: 2 }, price });
    assert.equal(sim.relays[0], false);
    sim.advanceTo('2026-10-06T00:05:00');
    assert.equal(sim.relays[0], true);
    sim.advanceTo('2026-10-06T00:35:00');
    assert.equal(sim.relays[0], false);
    assertAlive(sim);
  });
});
