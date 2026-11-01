/**
 * Jaksojen rajat kellonsiirtopäivinä.
 *
 * Jaksot asetetaan kellonaikoina, mutta hinnat käsitellään päivän alusta laskettuina.
 * Kesäaikaan siirryttäessä päivästä puuttuu tunti 03-04, joten rajat pitää korjata,
 * jotta ne osuvat kellonaikoihin kellonsiirron jälkeen.
 *
 * Yön tunteja ennen kellonsiirtoa ei tarkisteta: laite ei silloin vielä tiedä siirrosta.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { uiShared } = require('./sim/ui-shared.js');
const { boot, assertAlive } = require('./helpers');

const SPRING = '2026-03-29'; //kesäaikaan: 23 tuntia, 03 -> 04
const AUTUMN = '2026-10-25'; //talviaikaan: 25 tuntia, 04 -> 03
const NORMAL = '2026-10-06';

/** Hinta kellonajan mukaan: taulukko kellotunti -> hinta, muut tunnit 50 */
const byClock = (map) => (e, d) => map[d.getHours()] ?? 50;

/**
 * Ajaa päivän todellisessa ajassa (näyte 10 min välein) ja palauttaa kellonajat (hh:mm),
 * joilla lähtö oli päällä kello 04:00 jälkeen.
 */
function onAfterSwitch(date, inst, price, opts = {}) {
  const sim = boot(Object.assign({ start: `${date}T00:05:00`, inst, price }, opts));
  const start = sim.now().getTime();
  const hours = date === SPRING ? 23 : (date === AUTUMN ? 25 : 24);
  const res = [];
  let passed = false;

  for (let t = start; t < start + hours * 3600e3 - 10 * 60e3; t += 10 * 60e3) {
    sim.advanceTo(new Date(t));
    const now = sim.now();
    //Tarkastelu alkaa kello 04:00 (kellonsiirron jälkeen)
    passed = passed || now.getHours() >= 4 && t - start > 3 * 3600e3;

    if (passed && sim.relays[0]) {
      res.push(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    }
  }

  assertAlive(sim);
  assert.equal(sim.status(0).s.errTot, 0);
  return res;
}

/** Kellonajat (10 min välein) väliltä from-to, esim. span('07:00', '20:00') */
function span(from, to) {
  const min = (t) => Number(t.split(':')[0]) * 60 + Number(t.split(':')[1]);
  const res = [];
  for (let m = min(from) + 5; m < min(to); m += 10) {
    res.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return res;
}

for (const [name, date] of [['tavallinen päivä', NORMAL], ['kesäaikaan siirtyminen', SPRING], ['talviaikaan siirtyminen', AUTUMN]]) {
  describe(`jaksojen rajat kellonaikoina: ${name}`, () => {
    test('oma jakso 07-20, kaikki tunnit: päällä kello 07:00-20:00', () => {
      const on = onAfterSwitch(date, { mode: 2, m2: { p: -1, ps: 7, pe: 20, c: 13 } }, () => 50);
      assert.deepEqual(on, span('07:00', '20:00'));
    });

    test('oma jakso 07-20, halvin tunti jakson reunoilta', () => {
      //Kello 06 ja 20 ovat päivän halvimmat, mutta jakson ulkopuolella. Jakson sisällä halvin on 19.
      const on = onAfterSwitch(date, { mode: 2, m2: { p: -1, ps: 7, pe: 20, c: 1 } }, byClock({ 6: 1, 20: 1, 19: 10, 7: 20 }));
      assert.deepEqual(on, span('19:00', '20:00'));
    });

    test('kaksi omaa jaksoa 05-08 ja 16-22', () => {
      const on = onAfterSwitch(date, { mode: 2, m2: { p: -2, ps: 5, pe: 8, c: 1, ps2: 16, pe2: 22, c2: 2 } },
        byClock({ 4: 1, 5: 30, 6: 20, 7: 10, 8: 1, 15: 1, 16: 5, 21: 6, 22: 1 }));
      assert.deepEqual(on, [...span('07:00', '08:00'), ...span('16:00', '17:00'), ...span('21:00', '22:00')]);
    });

    test('12 h jaksot: toinen jakso alkaa kello 12:00', () => {
      //Kello 11 kuuluu ensimmäiseen jaksoon ja 12 toiseen
      const on = onAfterSwitch(date, { mode: 2, m2: { p: 12, c: 1 } }, byClock({ 1: 1, 11: 5, 12: 20, 13: 10 }));
      assert.deepEqual(on, span('13:00', '14:00'));
    });

    test('6 h jaksot: rajat kello 06, 12 ja 18', () => {
      const on = onAfterSwitch(date, { mode: 2, m2: { p: 6, c: 1 } },
        byClock({ 1: 1, 6: 10, 11: 20, 12: 10, 17: 20, 18: 10, 23: 20 }));
      assert.deepEqual(on, [...span('06:00', '07:00'), ...span('12:00', '13:00'), ...span('18:00', '19:00')]);
    });

    test('8 h jaksot, peräkkäiset 2 tuntia: jakso ei ylitä kello 16:n rajaa', () => {
      //Halvin pari olisi 15-17, mutta se ylittää jaksojen rajan
      const on = onAfterSwitch(date, { mode: 2, m2: { p: 8, c: 2, s: 1 } },
        byClock({ 1: 1, 2: 1, 15: 1, 16: 1, 9: 20, 10: 20, 20: 20, 21: 20 }));
      assert.deepEqual(on, [...span('09:00', '11:00'), ...span('20:00', '22:00')]);
    });

    test('24 h jakso: halvimmat tunnit koko päivästä', () => {
      const on = onAfterSwitch(date, { mode: 2, m2: { p: 24, c: 2 } }, byClock({ 14: 1, 22: 2 }));
      assert.deepEqual(on, [...span('14:00', '15:00'), ...span('22:00', '23:00')]);
    });

    test('15 min tarkkuus: oma jakso 07-09, 0.5 h', () => {
      const price = (e, d) => d.getHours() === 6 || d.getHours() === 9 ? 1 : (d.getHours() === 8 && d.getMinutes() >= 30 ? 10 : 50);
      const on = onAfterSwitch(date, { mode: 2, q: 1, m2: { p: -1, ps: 7, pe: 9, c: 0.5 } }, price);
      assert.deepEqual(on, span('08:30', '09:00'));
    });

    test('30 min tarkkuus: 12 h jaksot', () => {
      const price = (e, d) => d.getHours() === 11 && d.getMinutes() >= 30 ? 5 : (d.getHours() === 12 && d.getMinutes() < 30 ? 20 : (d.getHours() === 1 ? 1 : 50));
      const on = onAfterSwitch(date, { mode: 2, q: 2, m2: { p: 12, c: 0.5 } }, price);
      assert.deepEqual(on, span('12:00', '12:30'));
    });

    test('pakko-ohjatut ja varmuustunnit toimivat kellon mukaan', () => {
      const on = onAfterSwitch(date, { mode: 2, m2: { p: 24, c: 0 }, f: 1 << 9, fc: 1 << 9 }, () => 50);
      assert.deepEqual(on, span('09:00', '10:00'));
    });
  });
}

const TAB_STATUS = fs.readFileSync(path.join(__dirname, '..', 'src', 'statics', 'tab-status.js'), 'utf8');

/** Ajaa tilasivun koodin ja palauttaa rivit { time: 'hh:mm', on } */
function uiRows(state, now) {
  const elements = {};
  const pad = (n) => String(n).padStart(2, '0');
  class FixedDate extends Date { constructor(...args) { if (args.length === 0) { super(now); } else { super(...args); } } }

  const context = vm.createContext({
    ...uiShared(),
    state, inst: 0, CBS: [], Date: FixedDate, console,
    qs: (id) => elements[id] ?? (elements[id] = { innerHTML: '', style: {} }),
    MODE_STR: ['a', 'b', 'c'], STATE_STR: new Array(14).fill('tila'),
    formatTime: (d, sec = true) => `${pad(d.getHours())}:${pad(d.getMinutes())}${sec ? ':' + pad(d.getSeconds()) : ''}`,
    formatDateTime: (d) => d.toISOString()
  });
  vm.runInContext(TAB_STATUS, context, { filename: 'tab-status.js' });

  const rows = (elements['s-pa'].innerHTML + elements['s-pb'].innerHTML).split('<tr style=').slice(1);
  return rows.map(r => ({ time: (r.match(/(\d\d:\d\d)/) || [])[1], on: /&#x2714;/.test(r) }));
}

describe('tilasivun ennuste kellonsiirtopäivänä vastaa laitteen ohjausta kellonsiirron jälkeen', () => {

  for (const [name, date] of [['kesäaikaan', SPRING], ['talviaikaan', AUTUMN]]) {
    for (const [desc, inst] of [
      ['oma jakso 07-20, 4 h', { mode: 2, m2: { p: -1, ps: 7, pe: 20, c: 4 } }],
      ['12 h jaksot, 2 h', { mode: 2, m2: { p: 12, c: 2 } }],
      ['8 h jaksot, peräkkäiset 3 h', { mode: 2, m2: { p: 8, c: 3, s: 1 } }],
      ['kaksi omaa jaksoa', { mode: 2, m2: { p: -2, ps: 4, pe: 9, c: 2, ps2: 15, pe2: 23, c2: 3 } }]
    ]) {
      test(`${name}: ${desc}`, () => {
        const price = (e, d) => Math.round((Math.sin(e / 3600 * 1.3) * 40 + Math.cos(e / 3600 * 0.7) * 25 + 80)) / 10;
        const sim = boot({ start: `${date}T00:05:00`, inst, price });
        const start = sim.now().getTime();

        //Tilasivu kello 05:30 (kellonsiirron jälkeen, hinnat haettu uudelleen)
        const at = new Date(`${date}T05:30:00`);
        sim.advanceTo(at);
        const rows = uiRows(sim.status(0), sim.now().getTime());
        assert.ok(rows.length >= 23 && rows.every(r => r.time), 'tilasivun rivit luettu');

        //Laitteen ohjaus loppupäivän jokaisella tunnilla (näyte hh:30)
        for (let h = 6; h < 24; h++) {
          sim.advanceTo(`${date}T${String(h).padStart(2, '0')}:30:00`);
          const row = rows.filter(r => r.time === `${String(h).padStart(2, '0')}:00`).pop();
          assert.ok(row, `tilasivulla on rivi kello ${h}`);
          assert.equal(row.on, !!sim.relays[0], `kello ${h}: tilasivu ja laite`);
        }
        assertAlive(sim);
      });
    }
  }
});

describe('skriptin päivämäärät ja aikavyöhyke (simulaattori kuten laite)', () => {
  //Laite noudattaa kesäaikaa, mutta skriptin Date käyttää kaikille päivämäärille nykyistä poikkeamaa.
  //Mitattu Pro 2:lta (laiteohjelmisto 2.0.1, aikavyöhyke Europe/Helsinki, kesäaika):
  //  ["Thu Jan 15 2026 15:00:00 GMT+0300","Wed Jul 15 2026 15:00:00 GMT+0300"]
  //Sama tarkistus on laitetestissä (test/device/run.js), joten muutos laiteohjelmistossa näkyy siellä.
  const jan = Date.UTC(2026, 0, 15, 12), jul = Date.UTC(2026, 6, 15, 12);
  const expr = `JSON.stringify([new Date(${jan}).toString(), new Date(${jul}).toString()])`;

  test('kesäaikana: 15.1. ja 15.7. kesäajan poikkeamalla, sama tulos kuin laitteella', () => {
    const sim = boot({ start: '2026-10-21T12:51:00' });
    assert.deepEqual(JSON.parse(sim.evaluate(expr)), ['Thu Jan 15 2026 15:00:00 GMT+0300', 'Wed Jul 15 2026 15:00:00 GMT+0300']);
  });

  test('talviaikana: 15.1. ja 15.7. talviajan poikkeamalla', () => {
    const sim = boot({ start: '2026-11-20T12:00:00' });
    assert.deepEqual(JSON.parse(sim.evaluate(expr)), ['Thu Jan 15 2026 14:00:00 GMT+0200', 'Wed Jul 15 2026 14:00:00 GMT+0200']);
  });

  test('poikkeama vaihtuu kellonsiirron hetkellä kuten laitteen kello', () => {
    const sim = boot({ start: '2026-10-25T00:30:00' });
    const gmt = () => sim.evaluate('new Date().toString()').split('GMT')[1];
    sim.advanceTo(new Date(Date.UTC(2026, 9, 25, 0, 59, 0)));
    assert.equal(gmt(), '+0300');
    sim.advanceTo(new Date(Date.UTC(2026, 9, 25, 1, 1, 0)));
    assert.equal(gmt(), '+0200');
  });
});

describe('siirtomaksut kellonsiirtopäivinä kellonsiirron jälkeen', () => {
  //Kellonsiirtopäivät ovat sunnuntaita. Syksyllä päivän ensimmäinen hinta (00:00 kesäaikaa) on kellonsiirron
  //jälkeen talviajassa edellisen päivän puolella (la 23:00), joten päivä ja viikonpäivä pitää lukea päivän keskeltä.
  //Hinta 10 c/kWh ilman veroa, päivämaksu 3 ja yömaksu 1 -> 13 = päivämaksu, 11 = yömaksu
  const KAUSI = { tt: 1, ss: 1001, se: 331 };
  const hourOf = (t) => new Date(t * 1000).getHours();

  /** Skriptin laskemat tuntihinnat kello 10 (kellonsiirron jälkeen): [kellotunti, hinta] */
  const fees = (date, common = {}) => {
    const sim = boot({ start: `${date}T10:00:00`, price: () => 10, common: Object.assign({ vat: 0, day: 3, night: 1 }, common) });
    assertAlive(sim);
    return sim.rows(0).map(([t, p]) => [hourOf(t), Math.round(p * 100) / 100]);
  };

  for (const [name, date, hours] of [['kesäaikaan', SPRING, 23], ['talviaikaan', AUTUMN, 25]]) {
    test(`${name}: kausisiirto, sunnuntai koko päivän yömaksulla`, () => {
      const p = fees(date, KAUSI);
      assert.equal(p.length, hours);
      assert.deepEqual(p.filter(([, v]) => v != 11), [], 'ei päivämaksua');
    });

    test(`${name}: aikasiirto, päivämaksu kello 07-22`, () => {
      const p = fees(date);
      assert.equal(p.length, hours);
      assert.deepEqual(p.filter(([h, v]) => v != (h >= 7 && h < 22 ? 13 : 11)), [], 'päivä- ja yömaksu kellonajan mukaan');
    });

    for (const [res, q] of [['tunnin', 0], ['15 min', 1]]) {
      //15 min tarkkuudella hinnat lasketaan jokaisella logiikan ajolla (tuntitarkkuudella keskiyön tilastoista)
      test(`${name}: kausisiirto, 24 h jakson halvimmat ilman päivämaksua, ${res} tarkkuus`, () => {
        //Energia halvinta kello 10-12. Päivämaksulla (10 c/kWh) halvimmat olisivat kello 05-07.
        const on = onAfterSwitch(date, { mode: 2, q, m2: { p: 24, c: 2 } }, byClock({ 10: 1, 11: 1, 5: 3, 6: 3 }),
          { common: Object.assign({ day: 10, night: 0 }, KAUSI) });
        assert.deepEqual(on, span('10:00', '12:00'));
      });
    }
  }
});

describe('24 tunnin jakso kattaa koko kellonsiirtopäivän (myös 25 tunnin päivän ensimmäisen tunnin)', () => {
  //Ennen korjausta talviaikaan siirtymisen päivänä jakso alkoi kellonsiirron jälkeen vasta 01:00, jolloin valinta
  //muuttui kesken päivän ja päivän aikana saattoi tulla yksi tunti liikaa (esim. 7 h, kun asetus on 6 h)
  //Päivän ensimmäinen tunti (00) on halvin: ennen kellonsiirtoa se valitaan, ja sen jälkeen jakson pitää yhä sisältää se
  const price = byClock({ 0: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 6, 15: 7, 16: 8 });

  /** Ajaa koko päivän ja palauttaa jaksojen alut (epoch), joilla lähtö oli päällä */
  function daySlots(date, inst, slot) {
    const sim = boot({ start: `${date}T00:01:00`, inst, price });
    const start = sim.now().getTime();
    const hours = date === SPRING ? 23 : (date === AUTUMN ? 25 : 24);
    const on = new Set();

    for (let t = start + 4 * 60e3; t < start + hours * 3600e3 - 60e3; t += 5 * 60e3) {
      sim.advanceTo(new Date(t));
      if (sim.relays[0]) {
        on.add(Math.floor(t / 1000 / slot) * slot);
      }
    }
    assertAlive(sim);
    return { sim, on };
  }

  for (const [name, date] of [['kesäaikaan', SPRING], ['talviaikaan', AUTUMN]]) {
    for (const [desc, inst, slot, count] of [
      ['24 h jakso, 6 h', { mode: 2, m2: { p: 24, c: 6 } }, 3600, 6],
      ['24 h jakso, 6 h, 15 min tarkkuus', { mode: 2, q: 1, m2: { p: 24, c: 6 } }, 900, 24],
      ['oma jakso 00-24, 5 h', { mode: 2, m2: { p: -1, ps: 0, pe: 24, c: 5 } }, 3600, 5]
    ]) {
      test(`${name}: ${desc} - koko päivänä täsmälleen asetettu määrä`, () => {
        const { on } = daySlots(date, inst, slot);
        assert.equal(on.size, count);
      });
    }

    test(`${name}: tilasivun koko päivän suunnitelma vastaa laitteen toteutunutta ohjausta`, () => {
      const inst = { mode: 2, m2: { p: 24, c: 6 } };
      const { sim, on } = daySlots(date, inst, 3600);
      const s = sim.status(0);
      //Tilasivu kello 12 (päivän hinnat ovat vielä tämän päivän)
      const ui = boot({ start: `${date}T12:00:00`, inst, price });
      const rows = uiRows(ui.status(0), ui.now().getTime());
      const st = ui.status(0).s.p[0].st;
      const planned = rows.map((r, i) => r.on ? st + i * 3600 : null).filter(x => x !== null);
      assert.equal(rows.length, date === SPRING ? 23 : 25);
      assert.deepEqual([...on].sort(), planned.sort());
      assert.equal(s.s.errTot, 0);
    });
  }
});
