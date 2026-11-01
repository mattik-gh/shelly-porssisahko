/**
 * Varttiohjaus: ohjaus 15 minuutin hinnoilla (asetus q = 1).
 *
 * Sama logiikka kuin tuntiohjauksessa, mutta laskentayksikkö on 15 minuutin jakso:
 * tuntimäärä tarkoittaa neljää jaksoa per tunti, ja logiikka ajetaan vartin välein.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { boot, assertAlive, runDay, runDaySlots, slots, range, onTimes, hours, mask, DAY_BEFORE, DAY } = require('./helpers');

/** Hintafunktio: kaikki jaksot maksavat base, paitsi luetellut (kellonaika -> hinta) */
const priced = (base, special) => (e, d) => {
  const key = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return special[key] ?? base;
};

/** Käynnistää edellisenä iltana varttitilassa ja palauttaa päivän jaksot, joilla lähtö on päällä */
function day(inst, opts = {}) {
  const sim = boot(Object.assign({ start: DAY_BEFORE, inst: Object.assign({ q: 1 }, inst) }, opts));
  return runDaySlots(sim, DAY);
}

const same = (actual, expected) => assert.equal(onTimes(actual), onTimes(expected));

describe('varttiohjaus: hintaraja', () => {
  test('verrataan kuluvan vartin hintaa, ei tunnin keskiarvoa', () => {
    //Tunnin 10 vartit: 2, 8, 2, 8 (keskiarvo 5). Raja 4.
    const price = priced(10, { '10:00': 2, '10:15': 8, '10:30': 2, '10:45': 8 });

    same(day({ mode: 1, m1: { l: 4 } }, { price }), slots(['10:00', '10:30']));

    //Tuntiohjauksessa keskiarvo 5 on yli rajan -> ei ohjausta
    const sim = boot({ start: DAY_BEFORE, inst: { mode: 1, m1: { l: 4 }, q: 0 }, price });
    assert.deepEqual(runDay(sim, DAY), hours([]));
  });

  test('raja "avg" on päivän keskiarvo', () => {
    //Kaikki 10 paitsi kaksi halpaa varttia -> keskiarvo hieman alle 10
    const price = priced(10, { '03:15': 1, '18:45': 2 });
    same(day({ mode: 1, m1: { l: 'avg' } }, { price }), slots(['03:15', '18:45']));
  });

  test('tilakoodit 2 ja 3 vaihtuvat vartin mukaan', () => {
    const price = priced(10, { '10:00': 2, '10:30': 2 });
    const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 1, m1: { l: 4 }, q: 1 }, price });
    assert.equal(sim.status(0).si.st, 2);
    sim.advanceTo('2026-10-06T10:16:00');
    assert.equal(sim.status(0).si.st, 3);
    sim.advanceTo('2026-10-06T10:31:00');
    assert.equal(sim.status(0).si.st, 2);
  });
});

describe('varttiohjaus: jakson halvimmat', () => {
  test('1 tunti = 4 halvinta varttia vuorokaudesta', () => {
    const price = priced(10, { '02:15': 1, '07:45': 2, '13:00': 3, '23:30': 4, '05:00': 5 });
    same(day({ mode: 2, m2: { p: 24, c: 1 } }, { price }), slots(['02:15', '07:45', '13:00', '23:30']));
  });

  test('2 tuntia = 8 varttia', () => {
    const price = (e, d) => (d.getHours() * 4 + d.getMinutes() / 15 + 37) % 96;
    //hinta = (jakso + 37) % 96 -> halvimmat ovat jaksot 59..66 eli 14:45 - 16:30
    same(day({ mode: 2, m2: { p: 24, c: 2 } }, { price }), slots(range('14:45', '16:45')));
  });

  test('samanhintaisista valitaan aikaisemmat vartit', () => {
    same(day({ mode: 2, m2: { p: 24, c: 1 } }, { price: () => 5 }), slots(range('00:00', '01:00')));
  });

  test('12 tunnin jaksot, 1 tunti kummastakin', () => {
    const price = priced(10, { '01:15': 1, '03:30': 1, '08:00': 1, '11:45': 1, '12:00': 2, '15:15': 2, '20:30': 2, '23:45': 2, '06:00': 3 });
    same(day({ mode: 2, m2: { p: 12, c: 1 } }, { price }),
      slots(['01:15', '03:30', '08:00', '11:45', '12:00', '15:15', '20:30', '23:45']));
  });

  test('oma jakso 08-10', () => {
    const price = priced(10, { '02:00': 0, '08:15': 3, '09:45': 2, '08:00': 9, '10:00': 0 });
    //Jaksolla 08:00-10:00 on 8 varttia, joista valitaan 4 halvinta: 09:45 (2), 08:15 (3), 08:00 (9) ja ensimmäinen 10 c:n vartti
    same(day({ mode: 2, m2: { p: -1, ps: 8, pe: 10, c: 1 } }, { price }), slots(['08:00', '08:15', '08:30', '09:45']));
  });

  test('kaksi omaa jaksoa', () => {
    const price = priced(10, { '01:30': 1, '02:45': 1, '13:15': 1, '13:30': 2, '14:00': 3, '14:45': 4 });
    same(
      day({ mode: 2, m2: { p: -2, ps: 0, pe: 4, c: 1, ps2: 12, pe2: 16, c2: 1 } }, { price }),
      slots(['00:00', '00:15', '01:30', '02:45', '13:15', '13:30', '14:00', '14:45'])
    );
  });

  test('aina päällä -raja ja maksimihinta verrataan vartin hintaan', () => {
    const price = priced(10, { '02:00': 1, '02:15': 1, '02:30': 6, '02:45': 7, '09:15': 3, '17:30': 4 });
    //1 tunti = 4 halvinta: 02:00, 02:15, 09:15, 17:30. Aina päällä alle 6,5: lisäksi 02:30. Maksimi 3,5: pois 17:30 ja 02:30
    same(day({ mode: 2, m2: { p: 24, c: 1, l: 6.5 } }, { price }), slots(['02:00', '02:15', '02:30', '09:15', '17:30']));
    same(day({ mode: 2, m2: { p: 24, c: 1, m: 3.5 } }, { price }), slots(['02:00', '02:15', '09:15']));
  });
});

describe('varttiohjaus: peräkkäiset', () => {
  test('halvin yhtenäinen jakso voi alkaa mistä tahansa vartista', () => {
    //Halpa jakso 02:30-03:30 ylittää tunnin rajan
    const price = priced(10, { '02:30': 1, '02:45': 1, '03:00': 1, '03:15': 1, '06:00': 2, '06:15': 2, '06:30': 2, '06:45': 2 });
    same(day({ mode: 2, m2: { p: 24, c: 1, s: 1 } }, { price }), slots(range('02:30', '03:30')));

    //Tuntiohjaus samoilla hinnoilla valitsee tasatunnilta alkavan tunnin 06-07
    const sim = boot({ start: DAY_BEFORE, inst: { mode: 2, m2: { p: 24, c: 1, s: 1 }, q: 0 }, price });
    assert.deepEqual(runDay(sim, DAY), hours([6]));
  });

  test('3 tuntia peräkkäin = 12 varttia', () => {
    const price = (e, d) => Math.abs(d.getHours() * 4 + d.getMinutes() / 15 - 50);
    //Hinta on etäisyys jaksosta 50 (12:30) -> halvin 12 vartin ikkuna on 44..55 tai 45..56 (sama summa)
    const res = day({ mode: 2, m2: { p: 24, c: 3, s: 1 } }, { price });
    const on = res.map((v, i) => v ? i : -1).filter(i => i >= 0);
    assert.equal(on.length, 12);
    assert.equal(on[11] - on[0], 11, 'jaksot ovat peräkkäin');
    assert.ok(on[0] === 44 || on[0] === 45, `ikkuna alkaa jaksosta ${on[0]}`);
  });

  test('peräkkäiset omalla jaksolla', () => {
    const price = priced(10, { '09:30': 1, '09:45': 1, '10:00': 1, '10:15': 5, '03:00': 0, '03:15': 0, '03:30': 0, '03:45': 0 });
    //Jakso 08-12, 1 tunti peräkkäin: 09:30-10:30 (1+1+1+5 = 8) on halvin
    same(day({ mode: 2, m2: { p: -1, ps: 8, pe: 12, c: 1, s: 1 } }, { price }), slots(range('09:30', '10:30')));
  });
});

describe('varttiohjaus: muut asetukset', () => {
  test('pakko-ohjatut tunnit koskevat koko tuntia', () => {
    const price = priced(10, { '05:15': 1 });
    //Hintaraja 4 -> vain 05:15. Tunti 14 pakotettu päälle, tunti 5 pakotettu pois.
    same(day({ mode: 1, m1: { l: 4 }, f: mask([14]), fc: mask([14]) }, { price }), slots(['05:15'].concat(range('14:00', '15:00'))));
    same(day({ mode: 1, m1: { l: 4 }, f: mask([5]), fc: 0 }, { price }), slots([]));
  });

  test('varmuustunnit koskevat koko tuntia, kun hintoja ei ole', () => {
    const sim = boot({ start: DAY_BEFORE, inst: { mode: 1, m1: { l: 999 }, b: mask([3]), q: 1 }, settle: false });
    sim.net.mode = 'error';
    same(runDaySlots(sim, DAY), slots(range('03:00', '04:00')));
  });

  test('tunnin ohjausminuutit eivät vaikuta varttiohjauksessa', () => {
    same(day({ mode: 1, m1: { l: 999 }, m: 20 }, { price: () => 5 }), new Array(96).fill(1));

    //Tuntiohjauksessa sama asetus sammuttaa lähdön 20 minuutin jälkeen
    const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 1, m1: { l: 999 }, m: 20, q: 0 }, price: () => 5 });
    sim.advanceTo('2026-10-06T10:25:00');
    assert.equal(sim.relays[0], false);
  });

  test('käänteinen ohjaus', () => {
    const price = priced(10, { '10:00': 2, '10:30': 2 });
    const normal = day({ mode: 1, m1: { l: 4 } }, { price });
    same(day({ mode: 1, m1: { l: 4 }, i: 1 }, { price }), normal.map(v => v ? 0 : 1));
  });

  test('käsin annettu pakko-ohjaus toimii kuten ennen', () => {
    const sim = boot({ start: '2026-10-06T10:02:00', inst: { mode: 1, m1: { l: 0 }, q: 1 }, price: () => 5 });
    assert.equal(sim.relays[0], false);
    sim.force(0, 0.5, 1);
    sim.settle();
    assert.equal(sim.relays[0], true);
    sim.advanceTo('2026-10-06T10:20:00');
    assert.equal(sim.relays[0], true);
    sim.advanceTo('2026-10-06T10:34:00');
    assert.equal(sim.relays[0], false);
  });

  test('tuntiresoluution datalla varttiohjaus toimii tunneittain', () => {
    const sim = boot({ start: DAY_BEFORE, inst: { mode: 2, m2: { p: 24, c: 4 }, q: 1 }, resolution: 60 });
    assert.deepEqual(runDay(sim, DAY), hours([1, 2, 3, 4]));
  });
});

describe('varttiohjaus: logiikan ajoitus', () => {
  test('logiikka ajetaan vartin vaihtuessa', () => {
    const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 1, m1: { l: 999 }, q: 1 }, price: () => 5 });
    const runs = () => sim.switchLog.length;
    assert.equal(runs(), 1);

    sim.advanceTo('2026-10-06T10:14:00');
    assert.equal(runs(), 1);
    sim.advanceTo('2026-10-06T10:16:00');
    assert.equal(runs(), 2);
    sim.advanceTo('2026-10-06T11:01:00');
    assert.equal(runs(), 5);
  });

  test('tunti- ja varttiohjaus rinnakkain: kumpikin omalla tahdillaan ja samassa järjestyksessä', () => {
    const sim = boot({
      start: '2026-10-06T10:01:00',
      price: () => 5,
      inst: { mode: 1, m1: { l: 999 }, q: 0, o: [0] },
      kvs: {
        'porssi-2': { en: 1, mode: 1, m1: { l: 999 }, q: 1, o: [1] },
        'porssi-3': { en: 1, mode: 1, m1: { l: 999 }, q: 0, o: [2] }
      }
    });
    let n = sim.switchLog.length;
    sim.advanceTo('2026-10-06T10:59:00');
    assert.deepEqual(sim.switchLog.slice(n).map(s => s.id), [1, 1, 1], 'vain varttiohjaus ajetaan tunnin sisällä');

    n = sim.switchLog.length;
    sim.advanceTo('2026-10-06T11:01:00');
    assert.deepEqual(sim.switchLog.slice(n).map(s => s.id), [0, 1, 2], 'tasatunnilla kaikki järjestyksessä');
  });

  test('vuorokauden vaihtuminen varttiohjauksessa', () => {
    const price = (e, d) => d.getDate() === 6 ? 1 : 20;
    const sim = boot({ start: '2026-10-05T23:40:00', inst: { mode: 1, m1: { l: 10 }, q: 1 }, price });
    assert.equal(sim.relays[0], false);

    sim.advanceTo('2026-10-06T00:01:00');
    assertAlive(sim);
    assert.equal(sim.relays[0], true);
    assert.equal(sim.status(0).si.st, 2);
  });

  test('ALV ja siirtohinnat lasketaan vartin hintaan', () => {
    //Hinta 4 c + ALV 25,5 % + päiväsiirto 2 = 7,02. Yöllä 4 * 1,255 + 1 = 6,02.
    const sim = boot({
      start: DAY_BEFORE, price: () => 4,
      common: { vat: 25.5, day: 2, night: 1 },
      inst: { mode: 1, m1: { l: 6.5 }, q: 1 }
    });
    same(runDaySlots(sim, DAY), slots(range('00:00', '07:00').concat(range('22:00', '24:00'))));
    assert.equal(sim.slotRows(0).length, 96);
    assert.equal(sim.slotRows(0)[40][1], 4 * 1.255 + 2);
  });

  test('historia pysyy 24 rivissä', () => {
    //Joka toinen vartti päällä -> ohjaus muuttuu 96 kertaa päivässä
    const price = (e, d) => (d.getMinutes() / 15) % 2;
    const sim = boot({ start: DAY_BEFORE, inst: { mode: 1, m1: { l: 0 }, q: 1 }, price });
    runDaySlots(sim, DAY);
    assert.equal(sim.history(0).length, 24);
  });
});
