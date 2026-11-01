/**
 * Laitetestin kellonsiirtotestien testirajapinta (test/device/fake-elering.js).
 *
 * Testirajapinta on Shelly-skripti, joka vastaa laitteen sisällä Eleringin tavoin. Nämä testit varmistavat
 * simulaattorissa, että sen vastaus on merkki merkiltä sama kuin Elering-mallin (test/sim/elering.js)
 * ja että pääskripti saa siitä samat hinnat ja ohjaa samoin, myös kellonsiirtopäivinä.
 * Julkaistava skripti ei muutu: hakuosoite vaihdetaan vain testissä (opts.priceUrl, laitteella --dst).
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSim, ELERING_URL } = require('./sim/shelly-sim');
const { eleringCsv } = require('./sim/elering');
const { assertAlive, runDay } = require('./helpers');

const FAKE = fs.readFileSync(path.join(__dirname, 'device', 'fake-elering.js'), 'utf8');
const FAKE_URL = '"http://localhost/script/2/prices?fields="';

/** Simulaattori, jossa testirajapinta on toisena skriptinä ja pääskripti hakee siitä (fake = true) tai Elering-mallilta */
function start(at, fake, inst = { en: 1, mode: 2, m2: { p: 24, c: 6 } }) {
  const prices = fakePrices();
  const sim = createSim({
    start: at,
    priceUrl: fake ? FAKE_URL : null,
    resolution: 60,
    price: (ts, d) => prices[d.getHours()] / 10,
    kvs: { porssisahko: "[1,'fi',0,0,0,['-'],1,24]", 'porssisahko-1': JSON.stringify(inst) }
  });
  if (fake) {
    sim.runScript(FAKE, 'fake-elering.js');
  }
  sim.settle();
  assertAlive(sim);
  return sim;
}

function fakePrices() {
  const ctx = createSim({ start: '2026-10-06T10:00:00' }).runScript(FAKE, 'fake-elering.js');
  return JSON.parse(vm.runInContext('JSON.stringify(FAKE_PRICES)', ctx));
}

describe('kellotestien testirajapinta (test/device/fake-elering.js)', () => {
  const prices = fakePrices();

  const urls = [
    ['tavallinen päivä', '2026-10-06T00:00:00%2b03:00', '2026-10-06T23:59:59%2b03:00'],
    ['talviaika', '2026-12-01T00:00:00%2b02:00', '2026-12-01T23:59:59%2b02:00'],
    ['talviaikaan siirtyminen, 25 tuntia', '2026-10-25T00:00:00%2b03:00', '2026-10-26T00:59:59%2b02:00'],
    ['talviaikaan siirtyminen, pyynnön aikavyöhyke ennen siirtoa (kuten skripti pyytää)', '2026-10-25T00:00:00%2b03:00', '2026-10-25T23:59:59%2b03:00'],
    ['kesäaikaan siirtyminen, 23 tuntia', '2027-03-28T00:00:00%2b02:00', '2027-03-28T23:59:59%2b03:00'],
    ['kesäaikaan siirtyminen, pyynnön aikavyöhyke ennen siirtoa', '2027-03-28T00:00:00%2b02:00', '2027-03-28T23:59:59%2b02:00'],
    ['aikavyöhyke miinuksella', '2026-10-06T00:00:00-01:00', '2026-10-06T23:59:59-01:00']
  ];

  for (const [name, startStr, endStr] of urls) {
    test(`vastaus on merkki merkiltä sama kuin Elering-mallilla: ${name}`, () => {
      const sim = createSim({ start: '2026-10-06T10:00:00' });
      sim.runScript(FAKE, 'fake-elering.js');
      const query = `fields=fi&start=${startStr}&end=${endStr}`;
      const res = sim.request(query, 'prices');
      const expected = eleringCsv(`https://dashboard.elering.ee/api/nps/price/csv?${query}`, { price: (ts, d) => prices[d.getHours()] / 10, resolution: 60 });

      assert.equal(res.code, 200);
      assert.equal(JSON.stringify(res.headers), JSON.stringify([['Content-Type', 'application/octet-stream']]));
      assert.equal(res.body, expected);
    });
  }

  test('julkaistava skripti hakee Eleringiltä, ja osoite vaihdetaan vain testissä', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shelly-porssisahko.js'), 'utf8');
    assert.equal(src.split(ELERING_URL).length, 2, 'lähdekoodissa Eleringin osoite kerran');
    const dist = path.join(__dirname, '..', 'dist', 'shelly-porssisahko.js');
    if (fs.existsSync(dist)) {
      const code = fs.readFileSync(dist, 'utf8');
      assert.equal(code.split(ELERING_URL).length, 2, 'koontiversiossa Eleringin osoite kerran');
      assert.ok(!code.includes('localhost/script/2/prices'), 'koontiversiossa ei testirajapinnan osoitetta');
    }
  });

  for (const [name, day] of [['tavallinen päivä', '2026-10-06'], ['talviaikaan siirtyminen', '2026-10-25'], ['kesäaikaan siirtyminen', '2027-03-28']]) {
    test(`pääskripti saa testirajapinnasta samat hinnat ja ohjaa samoin kuin Elering-mallilla: ${name}`, () => {
      const prev = new Date(new Date(`${day}T12:00:00`).getTime() - 864e5);
      const pad = (n) => String(n).padStart(2, '0');
      const at = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}T16:00:00`;
      const a = start(at, true);
      const b = start(at, false);

      assert.ok(a.otherHttpLog.length === 0 && a.fetchCount() === 0, 'testirajapinnan versio ei hae Eleringiltä');
      assert.deepEqual(a.rows(1), b.rows(1), 'huomisen hinnat');
      assert.equal(a.status(0).s.errTot, 0);

      const da = runDay(a, day), db = runDay(b, day);
      assertAlive(a);
      assert.deepEqual(da, db, 'ohjaus vuorokauden aikana');
      assert.deepEqual(a.rows(0), b.rows(0), 'päivän hinnat');
      assert.deepEqual(a.history(0), b.history(0), 'historia');
      assert.equal(a.status(0).s.errTot, 0);
    });
  }
});
