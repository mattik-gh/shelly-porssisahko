/**
 * docs/unpack.md: esimerkkifunktiot, joilla ulkoinen ohjelma purkaa hinnat ja historian version 3.4.0 muotoon.
 *
 * Funktiot luetaan suoraan dokumentista ja ajetaan skriptin tilavastausta vasten, jotta ne pysyvät
 * yhtäpitävinä skriptin oman laskennan (calcPrices) kanssa.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { boot, assertAlive } = require('./helpers');

/** Dokumentin ensimmäinen koodilohko funktioineen */
function docFunctions() {
  const md = fs.readFileSync(path.join(__dirname, '..', 'docs', 'unpack.md'), 'utf8');
  const code = md.split('```js')[1].split('```')[0];
  const ctx = vm.createContext({ atob: (s) => Buffer.from(s, 'base64').toString('latin1'), Date });
  vm.runInContext(code + '\nthis.unpackPrices = unpackPrices; this.averageRows = averageRows; this.unpackHistory = unpackHistory;', ctx);
  //Tulokset tavallisiksi taulukoiksi (vm-kontekstin taulukoilla on eri prototyyppi, deepEqual ei hyväksy niitä)
  const plain = (fn) => (...args) => JSON.parse(JSON.stringify(fn(...args)));
  return { unpackPrices: plain(ctx.unpackPrices), averageRows: plain(ctx.averageRows), unpackHistory: plain(ctx.unpackHistory) };
}

const near = (a, b) => Math.abs(a - b) < 1e-9;

describe('docs/unpack.md: hintojen ja historian purku', () => {
  const price = (epoch, d) => [3, -1.2, 45.678, 120.5, 0, 7.5][d.getHours() % 6] + d.getMinutes() / 100;

  test('unpackPrices antaa jokaiselle jaksolle saman hinnan kuin skriptin calcPrices', () => {
    const sim = boot({ start: '2026-10-05T16:00:00', price, common: { vat: 25.5, day: 4.1, night: 2.35 } });
    const { unpackPrices } = docFunctions();
    const raw = sim.get('r=s&i=0').json;

    for (const day of [0, 1]) {
      const rows = unpackPrices(raw.p[day], raw.s.p[day].st, raw.s.p[day].sl, raw.c.vat, raw.c.day, raw.c.night);
      const expected = sim.slotRows(day);
      assert.equal(rows.length, 96, `päivä ${day}: 96 jaksoa`);
      assert.equal(rows.length, expected.length);
      rows.forEach((r, i) => {
        assert.equal(r[0], expected[i][0], `päivä ${day}, jakso ${i}: aika`);
        assert.ok(near(r[1], expected[i][1]), `päivä ${day}, jakso ${i}: hinta ${r[1]} vs ${expected[i][1]}`);
      });
    }
  });

  test('kausisiirto (v10): unpackPrices antaa saman hinnan kuin skripti, kun asetukset annetaan', () => {
    const { unpackPrices } = docFunctions();
    for (const [start, common] of [['2026-11-03T10:00:00', { tt: 1 }], ['2026-11-08T10:00:00', { tt: 1 }], ['2026-07-07T10:00:00', { tt: 1, ss: 601, se: 831, ds: 6, de: 23 }], ['2026-10-06T10:00:00', { ds: 9, de: 17 }], ['2027-02-15T10:00:00', { tt: 1, ss: 1010, se: 215, ds: 9, de: 14 }], ['2028-02-29T10:00:00', { tt: 1, ss: 810, se: 229, ds: 6, de: 18 }], ['2027-03-01T10:00:00', { tt: 1, ss: 810, se: 229, ds: 6, de: 18 }]]) {
      const sim = boot({ start, price, common: Object.assign({ vat: 25.5, day: 4.1, night: 2.35 }, common) });
      const raw = sim.get('r=s&i=0').json;
      const rows = unpackPrices(raw.p[0], raw.s.p[0].st, raw.s.p[0].sl, raw.c.vat, raw.c.day, raw.c.night, raw.c);
      const expected = sim.slotRows(0);
      assert.equal(rows.length, expected.length);
      rows.forEach((r, i) => assert.ok(near(r[1], expected[i][1]), `${start}, jakso ${i}: ${r[1]} vs ${expected[i][1]}`));
    }
  });

  test('ilman asetuksia unpackPrices laskee kuten versio 3.4.0 (päivämaksu joka päivä 07-22)', () => {
    const { unpackPrices } = docFunctions();
    const sim = boot({ start: '2026-11-08T10:00:00', price, common: { vat: 0, day: 4, night: 1 } });
    const raw = sim.get('r=s&i=0').json;
    const a = unpackPrices(raw.p[0], raw.s.p[0].st, raw.s.p[0].sl, 0, 4, 1);
    const b = unpackPrices(raw.p[0], raw.s.p[0].st, raw.s.p[0].sl, 0, 4, 1, raw.c);
    assert.deepEqual(a, b);
  });

  test('averageRows antaa version 3.4.0 muodon: 24 riviä, sama kuin skriptin tuntihinnat', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', price, common: { vat: 25.5, day: 4.1, night: 2.35 } });
    const { unpackPrices, averageRows } = docFunctions();
    const raw = sim.get('r=s&i=0').json;
    const rows = averageRows(unpackPrices(raw.p[0], raw.s.p[0].st, raw.s.p[0].sl, raw.c.vat, raw.c.day, raw.c.night));
    const expected = sim.rows(0);

    assert.equal(rows.length, 24);
    rows.forEach((r, i) => {
      assert.equal(r[0], expected[i][0]);
      assert.ok(near(r[1], expected[i][1]), `tunti ${i}: ${r[1]} vs ${expected[i][1]}`);
    });
    //Tuntien aikaleimat ovat tasatunteja
    assert.ok(rows.every(r => r[0] % 3600 === 0));
  });

  test('averageRows(rows, 1800) antaa 30 minuutin keskiarvot kuten skripti', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', price, common: { vat: 25.5, day: 4.1, night: 2.35 } });
    const { unpackPrices, averageRows } = docFunctions();
    const raw = sim.get('r=s&i=0').json;
    const rows = averageRows(unpackPrices(raw.p[0], raw.s.p[0].st, raw.s.p[0].sl, raw.c.vat, raw.c.day, raw.c.night), 1800);
    const expected = sim.halfRows(0);

    assert.equal(rows.length, 48);
    rows.forEach((r, i) => {
      assert.equal(r[0], expected[i][0]);
      assert.ok(near(r[1], expected[i][1]), `puolitunti ${i}: ${r[1]} vs ${expected[i][1]}`);
    });
  });

  test('ALV lisätään vain positiivisiin hintoihin ja siirto kellonajan mukaan', () => {
    const { unpackPrices } = docFunctions();
    //Kaksi jaksoa: -10 EUR/MWh klo 06:00 (yö) ja 100 EUR/MWh klo 07:00 (päivä), tunnin jaksot
    const pack = (values) => Buffer.from(values.flatMap(v => { const n = v + 8388608; return [n >> 16 & 255, n >> 8 & 255, n & 255]; })).toString('base64');
    const start = Math.floor(new Date('2026-10-05T06:00:00').getTime() / 1000);
    const rows = unpackPrices(pack([-1000, 10000]), start, 3600, 25.5, 4.1, 2.35);

    assert.deepEqual(rows.map(r => r[0]), [start, start + 3600]);
    assert.ok(near(rows[0][1], -1 + 2.35), 'negatiivinen: ei ALV:tä, yösiirto');
    assert.ok(near(rows[1][1], 10 * 1.255 + 4.1), 'positiivinen: ALV ja päiväsiirto');
  });

  test('unpackHistory antaa rivit [aika, ohjaus, tila] kuten versio 3.4.0', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 1 } } });
    sim.saveConfig(0, { m0: { c: 0 } });
    sim.settle();
    assertAlive(sim);
    const { unpackHistory } = docFunctions();
    const rows = unpackHistory(sim.get('r=h&i=0').body);

    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(r => [r[1], r[2]]), [[1, 1], [0, 1]], 'käsiohjaus päälle, sitten pois');
    //Aika minuutin tarkkuudella, nouseva
    const t0 = Math.floor(new Date('2026-10-05T10:00:00').getTime() / 1000);
    assert.ok(rows.every(r => r[0] % 60 === 0 && r[0] >= t0 - 60 && r[0] <= t0 + 600), JSON.stringify(rows));
    assert.ok(rows[0][0] <= rows[1][0]);
  });

  test('ennen kellonajan saamista kirjattu rivi saa ajan 0', () => {
    const { unpackHistory } = docFunctions();
    //Minuutit käynnistyksestä (3) ohjaus päälle, tila 8 (hätätila)
    const packed = Buffer.from([0, 0, 3, 16 | 8]).toString('base64');
    assert.deepEqual(unpackHistory(packed), [[0, 1, 8]]);
  });
});
