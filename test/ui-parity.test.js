/**
 * Käyttöliittymän ja laitekoodin vastaavuus.
 *
 * Tilasivu (src/statics/tab-status.js) laskee itse, mitkä tunnit ohjataan päälle,
 * ja lähdekoodin mukaan logiikan pitää vastata 1:1 laitteen logiikkaa.
 *
 * Testi ajaa tilasivun koodin kevyessä DOM-korvikkeessa laitteen palauttamalla
 * tilalla (r=s), lukee siitä ennustetut ohjaukset ja vertaa niitä siihen, miten
 * simuloitu laite todellisuudessa ohjaa lähtöä vuorokauden aikana.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { uiShared } = require('./sim/ui-shared.js');
const { boot, runDay, runDaySlots, onTimes, mask, DAY_BEFORE, DAY } = require('./helpers');

const TAB_STATUS = fs.readFileSync(path.join(__dirname, '..', 'src', 'statics', 'tab-status.js'), 'utf8');

/**
 * Ajaa tilasivun koodin annetulla tilalla ja palauttaa hintataulukon ennustamat ohjaukset
 *
 * @param {object} state r=s -vastaus
 * @param {number} dayIndex 0 = tänään, 1 = huomenna
 * @returns {number[]} ohjaus tunneittain (1 = päällä)
 */
function uiPrediction(state, dayIndex, now) {
  const elements = {};
  const pad = (n) => String(n).padStart(2, '0');

  class FixedDate extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super(now);
      } else {
        super(...args);
      }
    }
  }

  const context = vm.createContext({
      ...uiShared(),
    state,
    inst: 0,
    CBS: [],
    Date: FixedDate,
    console,
    qs: (id) => elements[id] ?? (elements[id] = { innerHTML: '', style: {} }),
    MODE_STR: ['mode0', 'mode1', 'mode2'],
    STATE_STR: new Array(14).fill('tila'),
    formatTime: (d, sec = true) => `${pad(d.getHours())}:${pad(d.getMinutes())}${sec ? ':' + pad(d.getSeconds()) : ''}`,
    formatDateTime: (d) => d.toISOString()
  });

  vm.runInContext(TAB_STATUS, context, { filename: 'tab-status.js' });

  //Näkyvissä on yksi päivä kerrallaan: huominen valitaan painikkeella kuten selaimessa
  if (dayIndex === 1) {
    elements['s-d1'].onclick();
  }

  //Rivit ovat kahdessa taulukossa (päivän alku- ja loppupuoli)
  const html = elements['s-pa'].innerHTML + elements['s-pb'].innerHTML;
  assert.doesNotMatch(elements['s-cmd'].innerHTML, /Tila ei tiedossa/, 'tilasivu päätyi virheeseen');

  //Jokainen hintarivi alkaa <tr style=...>, otsikkorivi ei
  return html.split('<tr style=').slice(1).map(row => row.includes('&#x2714;') ? 1 : 0);
}

/**
 * Vertaa käyttöliittymän ennustetta laitteen todelliseen ohjaukseen yhden vuorokauden ajalta
 */
function compare(inst, opts = {}) {
  const sim = boot(Object.assign({ start: DAY_BEFORE, inst }, opts));

  //Otetaan tila heti vuorokauden alusta, kun päivän hinnat on haettu
  sim.advanceTo(`${DAY}T00:05:00`);
  const state = sim.status(0);
  const predicted = uiPrediction(state, 0, sim.now().getTime());

  const actual = runDay(sim, DAY);

  assert.equal(predicted.length, 24);
  assert.deepEqual(predicted, actual, 'käyttöliittymän näyttämä ohjaus poikkeaa laitteen ohjauksesta');
}

describe('tilasivun ohjausennuste vastaa laitteen ohjausta', () => {
  test('käsiohjaus päällä', () => compare({ mode: 0, m0: { c: 1 } }));
  test('käsiohjaus pois', () => compare({ mode: 0, m0: { c: 0 } }));

  test('hintaraja', () => compare({ mode: 1, m1: { l: 6 } }));
  test('hintaraja "avg"', () => compare({ mode: 1, m1: { l: 'avg' } }));
  test('hintaraja, käänteinen', () => compare({ mode: 1, m1: { l: 6 }, i: 1 }));

  test('halvimmat tunnit, 24 h', () => compare({ mode: 2, m2: { p: 24, c: 5 } }));
  test('halvimmat tunnit, 8 h jaksot', () => compare({ mode: 2, m2: { p: 8, c: 2 } }));
  test('halvimmat tunnit, 5 h jaksot (ei mene tasan)', () => compare({ mode: 2, m2: { p: 5, c: 2 } }));
  test('halvimmat tunnit, peräkkäiset', () => compare({ mode: 2, m2: { p: 12, c: 3, s: 1 } }));
  test('kaksi omaa jaksoa, vain jakso 1 peräkkäin', () => compare({ mode: 2, m2: { p: -2, ps: 0, pe: 10, c: 3, ps2: 12, pe2: 24, c2: 4, s: 1, s2: 0 } }));
  test('kaksi omaa jaksoa, vain jakso 2 peräkkäin', () => compare({ mode: 2, m2: { p: -2, ps: 0, pe: 10, c: 3, ps2: 12, pe2: 24, c2: 4, s: 0, s2: 1 } }));
  test('halvimmat tunnit, oma jakso', () => compare({ mode: 2, m2: { p: -1, ps: 6, pe: 20, c: 4 } }));
  test('halvimmat tunnit, oma jakso peräkkäisillä', () => compare({ mode: 2, m2: { p: -1, ps: 6, pe: 20, c: 4, s: 1 } }));
  test('halvimmat tunnit, kaksi omaa jaksoa', () =>
    compare({ mode: 2, m2: { p: -2, ps: 0, pe: 7, c: 2, ps2: 15, pe2: 24, c2: 3 } }));
  test('halvimmat tunnit, aina päällä -raja', () => compare({ mode: 2, m2: { p: 24, c: 2, l: 4 } }));
  test('halvimmat tunnit, aina päällä -raja "avg"', () => compare({ mode: 2, m2: { p: 24, c: 2, l: 'avg' } }));
  test('halvimmat tunnit, maksimihinta', () => compare({ mode: 2, m2: { p: 6, c: 2, m: 6 } }));
  test('halvimmat tunnit, maksimihinta "avg"', () => compare({ mode: 2, m2: { p: 6, c: 3, m: 'avg' } }));
  test('halvimmat tunnit, maksimihinta alle aina päällä -rajan', () =>
    compare({ mode: 2, m2: { p: 24, c: 3, l: 5, m: 2 } }));

  test('peräkkäiset tunnit tasatilanteessa (nollahintaiset tunnit)', () => {
    const prices = [0, 0, 0, 0, 0, 0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 0, 0, 0, 0];
    compare({ mode: 2, m2: { p: 24, c: 3, s: 1 } }, { price: (e, d) => prices[d.getHours()] });
  });
  test('peräkkäiset tunnit tasatilanteessa (kaikki samanhintaisia)', () =>
    compare({ mode: 2, m2: { p: 12, c: 4, s: 1 } }, { price: () => 1.1 }));
  test('halvimmat tunnit tasatilanteessa (kaikki samanhintaisia)', () =>
    compare({ mode: 2, m2: { p: 8, c: 3 } }, { price: () => 1.1 }));

  test('pakko-ohjatut tunnit', () =>
    compare({ mode: 2, m2: { p: 24, c: 4 }, f: mask([2, 3, 17, 18]), fc: mask([17, 18]) }));
  test('pakko-ohjatut tunnit, käänteinen', () =>
    compare({ mode: 2, m2: { p: 24, c: 4 }, f: mask([2, 17]), fc: mask([17]), i: 1 }));

  test('ALV ja siirtohinnat mukana', () =>
    compare({ mode: 2, m2: { p: 24, c: 6, l: 5 } }, { common: { vat: 25.5, day: 4, night: 1.5 } }));

  test('vaihtelevat hinnat ja negatiivisia hintoja', () => {
    const price = (e, d) => Math.round(Math.sin(d.getHours() * 1.7) * 80 + d.getMinutes() / 10) / 10;
    compare({ mode: 2, m2: { p: 8, c: 3, l: -2, m: 6 } }, { price, common: { vat: 25.5 } });
  });

  test('huomisen ennuste vastaa seuraavan päivän ohjausta', () => {
    const price = (e, d) => Math.round(Math.sin(d.getHours() * 1.3 + d.getDate()) * 50 + 60) / 10;
    const sim = boot({ start: '2026-10-05T16:00:00', inst: { mode: 2, m2: { p: 12, c: 3 } }, price });

    const predicted = uiPrediction(sim.status(0), 1, sim.now().getTime());
    assert.deepEqual(predicted, runDay(sim, DAY));
  });
});

/**
 * Sama vertailu varttiohjaukselle: tilasivun 96 riviä vastaan laitteen ohjaus vartin välein
 */
function compareQ(inst, opts = {}) {
  //Hinta vaihtelee vartin välein
  const price = opts.price ?? ((e, d) => Math.round((Math.sin((d.getHours() * 4 + d.getMinutes() / 15) * 0.37) * 40 + Math.cos(d.getHours() * 1.9) * 25 + 60)) / 10);
  const sim = boot(Object.assign({ start: DAY_BEFORE, inst: Object.assign({ q: 1 }, inst), price }, opts));

  sim.advanceTo(`${DAY}T00:02:00`);
  const predicted = uiPrediction(sim.status(0), 0, sim.now().getTime());
  const actual = runDaySlots(sim, DAY);

  assert.equal(predicted.length, 96);
  assert.equal(onTimes(predicted), onTimes(actual), 'käyttöliittymän näyttämä ohjaus poikkeaa laitteen ohjauksesta');
}

describe('tilasivun ohjausennuste vastaa laitteen ohjausta varttiohjauksessa', () => {
  test('hintaraja', () => compareQ({ mode: 1, m1: { l: 6 } }));
  test('hintaraja "avg", käänteinen', () => compareQ({ mode: 1, m1: { l: 'avg' }, i: 1 }));
  test('halvimmat, 24 h, 3 tuntia', () => compareQ({ mode: 2, m2: { p: 24, c: 3 } }));
  test('halvimmat, 6 h jaksot', () => compareQ({ mode: 2, m2: { p: 6, c: 1 } }));
  test('halvimmat, 5 h jaksot (ei mene tasan)', () => compareQ({ mode: 2, m2: { p: 5, c: 2 } }));
  test('peräkkäiset, 24 h', () => compareQ({ mode: 2, m2: { p: 24, c: 2, s: 1 } }));
  test('peräkkäiset, 8 h jaksot', () => compareQ({ mode: 2, m2: { p: 8, c: 1, s: 1 } }));
  test('oma jakso', () => compareQ({ mode: 2, m2: { p: -1, ps: 6, pe: 20, c: 4 } }));
  test('kaksi omaa jaksoa, vain jakso 1 peräkkäin', () => compareQ({ mode: 2, m2: { p: -2, ps: 0, pe: 7, c: 2, ps2: 15, pe2: 24, c2: 3, s: 1, s2: 0 } }));
  test('kaksi omaa jaksoa, vain jakso 2 peräkkäin', () => compareQ({ mode: 2, m2: { p: -2, ps: 0, pe: 7, c: 2, ps2: 15, pe2: 24, c2: 3, s: 0, s2: 1 } }));
  test('kaksi omaa jaksoa, peräkkäiset', () => compareQ({ mode: 2, m2: { p: -2, ps: 0, pe: 7, c: 2, ps2: 15, pe2: 24, c2: 3, s: 1 } }));
  test('aina päällä -raja ja maksimihinta', () => compareQ({ mode: 2, m2: { p: 12, c: 2, l: 3, m: 8 } }));
  test('pakko-ohjatut tunnit', () => compareQ({ mode: 2, m2: { p: 24, c: 2 }, f: mask([2, 3, 17]), fc: mask([17]) }));
  test('ALV ja siirtohinnat', () => compareQ({ mode: 2, m2: { p: 24, c: 5, l: 6 } }, { common: { vat: 25.5, day: 4, night: 1.5 } }));
  test('tasatilanteet (kaikki samanhintaisia)', () => compareQ({ mode: 2, m2: { p: 8, c: 2 } }, { price: () => 1.1 }));
  test('tasatilanteet, peräkkäiset', () => compareQ({ mode: 2, m2: { p: 12, c: 3, s: 1 } }, { price: () => 1.1 }));
  test('tuntiresoluution data', () => compareQSame());
});

/**
 * Sama vertailu 30 minuutin tarkkuudelle: tilasivun 48 riviä vastaan laitteen ohjaus (näyte vartin välein)
 */
function compareH(inst, opts = {}) {
  const price = opts.price ?? ((e, d) => Math.round((Math.sin((d.getHours() * 4 + d.getMinutes() / 15) * 0.37) * 40 + Math.cos(d.getHours() * 1.9) * 25 + 60)) / 10);
  const sim = boot(Object.assign({ start: DAY_BEFORE, inst: Object.assign({ q: 2 }, inst), price }, opts));

  sim.advanceTo(`${DAY}T00:02:00`);
  const predicted = uiPrediction(sim.status(0), 0, sim.now().getTime());
  const actual = runDaySlots(sim, DAY);

  assert.equal(predicted.length, 48);
  const expanded = [];
  predicted.forEach(v => expanded.push(v, v));
  assert.equal(onTimes(expanded), onTimes(actual), 'käyttöliittymän näyttämä ohjaus poikkeaa laitteen ohjauksesta');
}

describe('tilasivun ohjausennuste vastaa laitteen ohjausta 30 minuutin tarkkuudella', () => {
  test('hintaraja', () => compareH({ mode: 1, m1: { l: 6 } }));
  test('hintaraja "avg", käänteinen', () => compareH({ mode: 1, m1: { l: 'avg' }, i: 1 }));
  test('halvimmat, 24 h, 2,5 tuntia', () => compareH({ mode: 2, m2: { p: 24, c: 2.5 } }));
  test('halvimmat, 6 h jaksot, 0,5 tuntia', () => compareH({ mode: 2, m2: { p: 6, c: 0.5 } }));
  test('peräkkäiset, 8 h jaksot, 1,5 tuntia', () => compareH({ mode: 2, m2: { p: 8, c: 1.5, s: 1 } }));
  test('kaksi omaa jaksoa', () => compareH({ mode: 2, m2: { p: -2, ps: 0, pe: 7, c: 1.5, ps2: 15, pe2: 24, c2: 3.5, s: 1 } }));
  test('aina päällä -raja ja maksimihinta', () => compareH({ mode: 2, m2: { p: 12, c: 2, l: 3, m: 8 } }));
  test('pakko-ohjatut tunnit', () => compareH({ mode: 2, m2: { p: 24, c: 2 }, f: mask([2, 3, 17]), fc: mask([17]) }));
  test('ALV ja siirtohinnat', () => compareH({ mode: 2, m2: { p: 24, c: 4.5, l: 6 } }, { common: { vat: 25.5, day: 4, night: 1.5 } }));
  test('tasatilanteet, peräkkäiset', () => compareH({ mode: 2, m2: { p: 12, c: 2.5, s: 1 } }, { price: () => 1.1 }));
  test('varttitila ja murto-osatunnit (1,25 h ja 0,75 h)', () => {
    compareQ({ mode: 2, m2: { p: 24, c: 1.25 } });
    compareQ({ mode: 2, m2: { p: 8, c: 0.75, s: 1 } });
  });
});

/** Tuntiresoluution datalla varttitilan näkymässä on 24 riviä */
function compareQSame() {
  const sim = boot({ start: DAY_BEFORE, inst: { mode: 2, m2: { p: 24, c: 5 }, q: 1 }, resolution: 60 });
  sim.advanceTo(`${DAY}T00:02:00`);
  const predicted = uiPrediction(sim.status(0), 0, sim.now().getTime());
  assert.equal(predicted.length, 24);
  assert.deepEqual(predicted, runDay(sim, DAY));
}

describe('käyttöliittymän hintojen purku (s.js)', () => {
  test('pakatut hinnat puretaan samoiksi arvoiksi kuin skriptin muistissa', () => {
    //Poimitaan s.js:stä hintojen purkufunktio ja ajetaan se skriptin oikealla vastauksella
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'statics', 's.js'), 'utf8');
    const match = source.match(/state\.p = state\.p\.map\((str => \{[\s\S]*?\n      \})\);/);
    assert.ok(match, 's.js:stä löytyy hintojen purku');

    const unpack = vm.runInNewContext(`(${match[1]})`, { atob: (str) => Buffer.from(str, 'base64').toString('latin1') });
    const price = (e, d) => d.getHours() === 3 ? -50 : (d.getHours() === 18 ? 400 : d.getHours() + d.getMinutes() / 100);
    const sim = boot({ start: '2026-10-05T16:00:00', price });
    const raw = sim.get('r=s&i=0').json.p;

    assert.deepEqual(raw.map(str => Array.from(unpack(str))), [sim.prices(0), sim.prices(1)]);
    assert.equal(sim.prices(0).length, 96);
    assert.equal(sim.prices(0)[12], -50000);
    assert.equal(sim.prices(0)[72], 400000);
  });
});

describe('tilasivun hintakaavio', () => {
  /** Ajaa tilasivun ja palauttaa kaavion pylväät sekä taulukon rivit */
  function chart(sim, dayIndex = 0) {
    const elements = {};
    const pad = (n) => String(n).padStart(2, '0');
    const now = sim.now().getTime();
    class FixedDate extends Date { constructor(...args) { if (args.length === 0) { super(now); } else { super(...args); } } }

    const context = vm.createContext({
      ...uiShared(),
      state: sim.status(0), inst: 0, CBS: [], Date: FixedDate, console,
      qs: (id) => elements[id] ?? (elements[id] = { innerHTML: '', style: {} }),
      MODE_STR: ['a', 'b', 'c'], STATE_STR: new Array(14).fill('tila'),
      formatTime: (d, sec = true) => `${pad(d.getHours())}:${pad(d.getMinutes())}${sec ? ':' + pad(d.getSeconds()) : ''}`,
      formatDateTime: (d) => d.toISOString()
    });
    vm.runInContext(TAB_STATUS, context, { filename: 'tab-status.js' });

    if (dayIndex === 1) {
      elements['s-d1'].onclick();
    }

    const html = elements['s-g'].innerHTML;
    //Ohjaus on omana palkkinaan pylväiden alla: yksi lohko jokaista pylvästä kohti
    const cells = [...(html.match(/<div class="gs">(.*?)<\/div>/s) || ['', ''])[1].matchAll(/<i class="([^"]*)"(?: title="([^"]*)")?><\/i>/g)];
    const strip = cells.map(m => m[1].split(' '));
    const bars = [...html.matchAll(/<i class="([^"]*)" style="height:([\d.]+)%;--f:([\d.]+)%" title="([^"]*)"><\/i>/g)]
      .map((m, i) => ({ on: (strip[i] || []).includes('on'), edge: (strip[i] || []).filter(c => c === 'l' || c === 'r').join(''), tip: (cells[i] || [])[2], active: m[1].split(' ').includes('a'), height: Number(m[2]), fee: Number(m[3]), title: m[4] }));
    assert.equal(strip.length, bars.length, 'ohjauspalkissa on lohko jokaiselle pylväälle');
    const rows = (elements['s-pa'].innerHTML + elements['s-pb'].innerHTML).split('<tr style=').slice(1).map(r => /&#x2714;/.test(r));
    const scale = (html.match(/<div class="gy"><span>([\d.]+)<\/span>/) || [])[1];
    return { html, bars, rows, scale: Number(scale), total: elements['s-gt'].innerHTML, note: elements['s-bn'].style.display, onAvg: elements['s-pc'].innerHTML, info: elements['s-pi'].innerHTML };
  }

  test('pylväitä on yhtä monta kuin taulukossa rivejä ja ohjaus on sama', () => {
    for (const [q, count] of [[0, 24], [2, 48], [1, 96]]) {
      const sim = boot({ start: '2026-10-06T10:20:00', inst: { mode: 2, q, m2: { p: 6, c: 1.5 } } });
      const { bars, rows } = chart(sim);
      assert.equal(bars.length, count, `tarkkuus ${q}`);
      assert.deepEqual(bars.map(b => b.on), rows, `tarkkuus ${q}: pylvään väri vastaa taulukon ohjausta`);
      assert.equal(bars.filter(b => b.active).length, 1, 'kuluva jakso on merkitty');
    }
  });

  test('pylvään korkeus on hinta ja tumma osa siirtomaksu', () => {
    //Energia 4 c/kWh (ei ALV:a), siirto päivällä 6 ja yöllä 1 -> hinta 10 / 5, asteikko 10
    const sim = boot({ start: '2026-10-06T10:20:00', inst: { mode: 1, m1: { l: 0 } }, common: { day: 6, night: 1 }, price: () => 4 });
    const { bars, scale } = chart(sim);

    assert.equal(scale, 10);
    assert.equal(bars[12].height, 100, 'kello 12: 10 c/kWh asteikolla 10');
    assert.equal(bars[12].fee, 60, 'siirron osuus 6 / 10');
    assert.equal(bars[2].height, 50, 'kello 02: 5 c/kWh');
    assert.equal(bars[2].fee, 20, 'siirron osuus 1 / 5');
    assert.equal(bars[12].title, '12:00 - ohjaus pois&#10;10.00 c/kWh (energia 4.00 + siirto 6.00)');
  });

  test('negatiivinen energian hinta ei pienennä pylvästä siirtomaksun alle', () => {
    const sim = boot({ start: '2026-10-06T10:20:00', inst: { mode: 1, m1: { l: 999 } }, common: { day: 4, night: 4 }, price: (e, d) => d.getHours() === 3 ? -10 : 4 });
    const { bars } = chart(sim);

    assert.equal(bars[3].height, 40, 'kello 03: pylväs on siirtomaksun korkuinen (4 / 10)');
    assert.equal(bars[3].fee, 100, 'koko pylväs on siirtoa');
    assert.equal(bars[3].title, '03:00 - ohjaus päällä&#10;-6.00 c/kWh (energia -10.00 + siirto 4.00)', 'vihjeessä näkyvät lasketut hinnat');
    assert.equal(bars[3].on, true);
  });

  test('ilman siirtomaksua ja nollahinnalla pylväs on tyhjä eikä kaadu', () => {
    const sim = boot({ start: '2026-10-06T10:20:00', inst: { mode: 1, m1: { l: 5 } }, price: () => 0 });
    const { bars } = chart(sim);
    assert.equal(bars.length, 24);
    assert.ok(bars.every(b => b.height === 0 && b.fee === 0));
  });

  test('ohjauspalkin jaksojen alku ja loppu on merkitty', () => {
    //Hinta alle rajan kello 03-05 ja kello 23 -> kaksi jaksoa
    const sim = boot({ start: '2026-10-06T10:20:00', inst: { mode: 1, m1: { l: 5 } }, price: (e, d) => [3, 4, 23].includes(d.getHours()) ? 1 : 10 });
    const { bars } = chart(sim);

    assert.deepEqual(bars.map((b, i) => b.on ? i : null).filter(i => i !== null), [3, 4, 23]);
    assert.equal(bars[3].edge, 'l', 'jakson alku');
    assert.equal(bars[4].edge, 'r', 'jakson loppu');
    assert.equal(bars[23].edge, 'lr', 'yhden tunnin jakso päivän lopussa');
    assert.equal(bars[5].edge, '');
  });

  test('ohjauspalkin vihje näyttää jakson alun, lopun ja keston', () => {
    //Tuntitarkkuus: päällä kello 03-05 ja 23-24
    let sim = boot({ start: '2026-10-06T10:20:00', inst: { mode: 1, m1: { l: 5 } }, price: (e, d) => [3, 4, 23].includes(d.getHours()) ? 1 : 10 });
    let bars = chart(sim).bars;
    assert.equal(bars[3].tip, 'Ohjaus päällä 03:00 - 05:00 (2h)');
    assert.equal(bars[4].tip, bars[3].tip, 'sama vihje koko jakson ajan');
    assert.equal(bars[23].tip, 'Ohjaus päällä 23:00 - 24:00 (1h)');
    assert.equal(bars[5].tip, undefined, 'ei vihjettä, kun ohjaus on pois');

    //15 min tarkkuus: päällä 10:15-11:45 ja yksi vartti 14:30
    sim = boot({ start: '2026-10-06T10:20:00', inst: { mode: 1, m1: { l: 5 }, q: 1 }, price: (e, d) => { const m = d.getHours() * 60 + d.getMinutes(); return (m >= 615 && m < 705) || m === 870 ? 1 : 10; } });
    bars = chart(sim).bars;
    assert.equal(bars[41].tip, 'Ohjaus päällä 10:15 - 11:45 (1h 30min)');
    assert.equal(bars[46].tip, 'Ohjaus päällä 10:15 - 11:45 (1h 30min)');
    assert.equal(bars[58].tip, 'Ohjaus päällä 14:30 - 14:45 (15min)');

    //30 min tarkkuus
    sim = boot({ start: '2026-10-06T10:20:00', inst: { mode: 1, m1: { l: 5 }, q: 2 }, price: (e, d) => d.getHours() === 6 && d.getMinutes() >= 30 ? 1 : 10 });
    assert.equal(chart(sim).bars[13].tip, 'Ohjaus päällä 06:30 - 07:00 (30min)');
  });

  test('selitteessä on päivän kytkentäaika yhteensä', () => {
    //Tuntitarkkuus: päällä kello 03-05 ja 23-24
    let sim = boot({ start: '2026-10-06T10:20:00', inst: { mode: 1, m1: { l: 5 } }, price: (e, d) => [3, 4, 23].includes(d.getHours()) ? 1 : 10 });
    assert.equal(chart(sim).total, '(3h)');

    //15 min tarkkuus: päällä 10:15-11:45 ja yksi vartti 14:30
    sim = boot({ start: '2026-10-06T10:20:00', inst: { mode: 1, m1: { l: 5 }, q: 1 }, price: (e, d) => { const m = d.getHours() * 60 + d.getMinutes(); return (m >= 615 && m < 705) || m === 870 ? 1 : 10; } });
    assert.equal(chart(sim).total, '(1h 45min)');

    //Ohjaus ei ole päällä lainkaan
    sim = boot({ start: '2026-10-06T10:20:00', inst: { mode: 1, m1: { l: 5 } }, price: () => 10 });
    assert.equal(chart(sim).total, '(0h)');
  });

  test('limittäiset omat jaksot lasketaan kytkentäaikaan vain kerran', () => {
    //Jaksot 00-06 ja 03-09, kummastakin 3 halvinta tuntia: tunnit 3, 4 ja 5 ovat halvimmat molemmissa
    const sim = boot({ start: '2026-10-06T10:20:00', inst: { mode: 2, m2: { p: -2, ps: 0, pe: 6, ps2: 3, pe2: 9, c: 3, c2: 3 } }, price: (e, d) => [3, 4, 5].includes(d.getHours()) ? 1 : 10 });
    const c = chart(sim);
    assert.equal(c.bars.filter(b => b.on).length, 3);
    assert.equal(c.total, '(3h)');
  });

  test('ohjauksen keskihinta: päälle suunniteltujen jaksojen hintojen keskiarvo', () => {
    //Tuntitarkkuus: päällä kello 03 (1 c), 04 (2 c) ja 23 (6 c)
    const price = (e, d) => ({ 3: 1, 4: 2, 23: 6 })[d.getHours()] ?? 10;
    let c = chart(boot({ start: '2026-10-06T10:20:00', inst: { mode: 1, m1: { l: 7 } }, price }));
    assert.equal(c.bars.filter(b => b.on).length, 3);
    assert.equal(c.onAvg, '3.00 c/kWh');
    assert.match(c.info, /Ohjauksen keskihinta<\/td><\/tr>/);
    assert.match(c.info, /<td id="s-pc"><\/td>/);

    //15 min tarkkuus: jokainen vartti painaa yhtä paljon (kolme varttia 2 c ja yksi 6 c)
    const q = (e, d) => { const m = d.getHours() * 60 + d.getMinutes(); return m >= 600 && m < 645 ? 2 : m === 645 ? 6 : 10; };
    c = chart(boot({ start: '2026-10-06T10:20:00', inst: { mode: 1, m1: { l: 7 }, q: 1 }, price: q }));
    assert.equal(c.onAvg, '3.00 c/kWh');

    //Ohjaus ei ole päivän aikana lainkaan päällä
    c = chart(boot({ start: '2026-10-06T10:20:00', inst: { mode: 1, m1: { l: 5 } }, price: () => 10 }));
    assert.equal(c.onAvg, '-');
  });

  describe('jaksojen viiva pylväiden ja ohjauspalkin välissä', () => {
    const price = (e, d) => d.getHours() + 1;
    //Palauttaa viivan solut: 'd' = tumma, 'l' = vaalea, '' = ei jaksoa, sekä vihjeet
    function line(inst) {
      const html = chart(boot({ start: '2026-10-06T10:20:00', inst, price })).html;
      //Rivi jätetään kokonaan pois, kun näytettävää jaksoa ei ole
      const cells = [...(html.match(/<div class="gp">(.*?)<\/div>/s) || ['', ''])[1].matchAll(/<i(?: class="([dl])" title="([^"]*)")?><\/i>/g)];
      return { kinds: cells.map(m => m[1] || '-').join(''), tip: (i) => cells[i][2] };
    }

    test('tasajaksot: joka toinen jakso tumma ja joka toinen vaalea, vihjeessä jakson alku ja loppu', () => {
      const l = line({ mode: 2, m2: { p: 6, c: 2 } });
      assert.equal(l.kinds, 'dddddd' + 'llllll' + 'dddddd' + 'llllll');
      assert.equal(l.tip(0), 'Jakso 00:00 - 06:00');
      assert.equal(l.tip(11), 'Jakso 06:00 - 12:00');
      assert.equal(l.tip(23), 'Jakso 18:00 - 24:00');
    });

    test('omat jaksot: viiva vain jaksojen kohdalla', () => {
      const l = line({ mode: 2, m2: { p: -2, ps: 0, pe: 6, c: 3, ps2: 18, pe2: 21, c2: 1 } });
      assert.equal(l.kinds, 'dddddd' + '------------' + 'lll' + '---');
      assert.equal(l.tip(3), 'Jakso 00:00 - 06:00');
      assert.equal(l.tip(19), 'Jakso 18:00 - 21:00');
      assert.equal(l.tip(10), undefined);
    });

    test('yksi oma jakso', () => {
      assert.equal(line({ mode: 2, m2: { p: -1, ps: 7, pe: 20, c: 4 } }).kinds, '-------' + 'ddddddddddddd' + '----');
    });

    test('limittäiset omat jaksot: päällekkäisessä kohdassa näkyy jälkimmäinen jakso', () => {
      const l = line({ mode: 2, m2: { p: -2, ps: 0, pe: 24, c: 4, ps2: 0, pe2: 6, c2: 1 } });
      assert.equal(l.kinds, 'llllll' + 'dddddddddddddddddd');
      assert.equal(l.tip(2), 'Jakso 00:00 - 06:00');
      assert.equal(l.tip(12), 'Jakso 00:00 - 24:00');
    });

    test('15 minuutin tarkkuus: viiva seuraa hintojen määrää', () => {
      const l = line({ mode: 2, q: 1, m2: { p: 12, c: 2 } });
      assert.equal(l.kinds, 'd'.repeat(48) + 'l'.repeat(48));
      assert.equal(l.tip(50), 'Jakso 12:00 - 24:00');
    });

    test('viivan riviä ei ole lainkaan, kun koko päivä on yksi jakso tai ohjaustapa on muu', () => {
      const none = '';
      assert.equal(line({ mode: 2, m2: { p: 24, c: 5 } }).kinds, none, '24 h jakso');
      assert.equal(line({ mode: 2, m2: { p: -1, ps: 0, pe: 24, c: 5 } }).kinds, none, 'oma jakso 00-24');
      assert.equal(line({ mode: 1, m1: { l: 5 } }).kinds, none, 'hintaraja');
      assert.equal(line({ mode: 0, m0: { c: 1 } }).kinds, none, 'käsiohjaus');
    });
  });

  test('taustavärin selitys näkyy taulukon alla vain, kun taulukossa on jaksojen väritys', () => {
    const price = (e, d) => d.getHours() + 1;
    const note = (inst) => chart(boot({ start: '2026-10-06T10:20:00', inst, price })).note;
    assert.equal(note({ mode: 2, m2: { p: 6, c: 2 } }), 'block', '6 h jaksot');
    assert.equal(note({ mode: 2, m2: { p: -1, ps: 0, pe: 6, c: 2 } }), 'block', 'oma jakso');
    assert.equal(note({ mode: 2, m2: { p: -2, ps: 0, pe: 24, c: 4, ps2: 0, pe2: 6, c2: 1 } }), 'block', 'limittäiset omat jaksot');
    assert.equal(note({ mode: 2, m2: { p: 24, c: 2 } }), 'none', '24 h jaksossa ei ole rajoja päivän sisällä');
    assert.equal(note({ mode: 1, m1: { l: 5 } }), 'none', 'hintaraja');
    assert.equal(note({ mode: 0, m0: { c: 1 } }), 'none', 'käsiohjaus');
  });

  test('ohjaus ei vaikuta pylvään ulkoasuun', () => {
    const sim = boot({ start: '2026-10-06T10:20:00', inst: { mode: 1, m1: { l: 5 } }, price: (e, d) => d.getHours() === 3 ? 1 : 10 });
    assert.ok(!/<div class="gb">.*class="[^"]*on/s.test(chart(sim).html.split('<div class="gs">')[0]));
  });

  test('asteikko on sama tälle päivälle ja huomiselle', () => {
    const sim = boot({ start: '2026-10-06T16:00:00', inst: { mode: 1, m1: { l: 5 } }, price: (e, d) => d.getDate() === 6 ? 3 : 17 });
    assert.equal(chart(sim, 0).scale, 20);
    assert.equal(chart(sim, 1).scale, 20);
    assert.equal(chart(sim, 0).bars[5].height, 15, 'tänään 3 / 20');
  });

  test('huomisen kaavio on tyhjä, kun hintoja ei vielä ole', () => {
    const sim = boot({ start: '2026-10-06T10:20:00', inst: { mode: 1, m1: { l: 5 } } });
    assert.equal(chart(sim, 1).html, '');
  });
});

describe('tilasivun päivän valinta (tänään / huomenna)', () => {
  /** Tilasivu, jonka päivityksen voi ajaa uudelleen kuten selaimen 5 s päivitys */
  function page(sim) {
    const elements = {};
    const pad = (n) => String(n).padStart(2, '0');
    const now = sim.now().getTime();
    class FixedDate extends Date { constructor(...args) { if (args.length === 0) { super(now); } else { super(...args); } } }
    const context = vm.createContext({
      ...uiShared(),
      state: sim.status(0), inst: 0, CBS: [], Date: FixedDate, console,
      qs: (id) => elements[id] ?? (elements[id] = { innerHTML: '', style: {} }),
      MODE_STR: ['a', 'b', 'c'], STATE_STR: new Array(14).fill('tila'),
      formatTime: (d, sec = true) => `${pad(d.getHours())}:${pad(d.getMinutes())}${sec ? ':' + pad(d.getSeconds()) : ''}`,
      formatDateTime: (d) => d.toISOString()
    });
    vm.runInContext(TAB_STATUS, context, { filename: 'tab-status.js' });
    const rows = (id) => elements[id].innerHTML.split('<tr style=').slice(1).map(r => r.match(/class="fit">(\d\d:\d\d)/)[1]);
    return { elements, rows, refresh: () => vm.runInContext('CBS[0]()', context), avg: () => elements['s-pi'].innerHTML.match(/<td>([\d.-]+) c\/kWh<\/td>/)[1] };
  }

  //Tänään 3 c/kWh, huomenna 7 c/kWh
  const price = (e, d) => d.getDate() === 6 ? 3 : 7;

  test('oletuksena näkyy tämä päivä ja painike on valittuna', () => {
    const p = page(boot({ start: '2026-10-06T16:00:00', inst: { mode: 1, m1: { l: 5 } }, price }));
    assert.equal(p.elements['s-d0'].className, 'sel');
    assert.equal(p.elements['s-d1'].className, '');
    assert.equal(p.avg(), '3.00');
    assert.match(p.elements['s-g'].innerHTML, /title="00:00 - ohjaus päällä&#10;3\.00 c\/kWh/);
  });

  test('Huomenna-painike vaihtaa kaavion, tunnusluvut ja taulukon', () => {
    const p = page(boot({ start: '2026-10-06T16:00:00', inst: { mode: 1, m1: { l: 5 } }, price }));
    p.elements['s-d1'].onclick();

    assert.equal(p.elements['s-d1'].className, 'sel');
    assert.equal(p.elements['s-d0'].className, '');
    assert.equal(p.avg(), '7.00');
    assert.match(p.elements['s-g'].innerHTML, /title="00:00 - ohjaus pois&#10;7\.00 c\/kWh/);
    assert.ok(!p.elements['s-g'].innerHTML.includes('class=" a"'), 'huomisessa ei ole kuluvaa jaksoa');

    p.elements['s-d0'].onclick();
    assert.equal(p.avg(), '3.00');
  });

  test('valinta säilyy sivun päivittyessä', () => {
    const p = page(boot({ start: '2026-10-06T16:00:00', inst: { mode: 1, m1: { l: 5 } }, price }));
    p.elements['s-d1'].onclick();
    p.refresh();
    assert.equal(p.elements['s-d1'].className, 'sel');
    assert.equal(p.avg(), '7.00');
  });

  test('huomisen painike on himmennetty, kun hintoja ei vielä ole', () => {
    const p = page(boot({ start: '2026-10-06T10:00:00', inst: { mode: 1, m1: { l: 5 } }, price }));
    assert.equal(p.elements['s-d0'].style.opacity, 1);
    assert.equal(p.elements['s-d1'].style.opacity, 0.5);

    p.elements['s-d1'].onclick();
    assert.match(p.elements['s-pa'].innerHTML, /Ei vielä tiedossa/);
    assert.equal(p.elements['s-pb'].innerHTML, '');
    assert.equal(p.elements['s-g'].innerHTML, '');
    assert.equal(p.elements['s-gt'].innerHTML, '', 'kytkentäaikaa ei näytetä ilman hintoja');
    //Tunnuslukujen taulukossa on samat neljä saraketta kuin hintojen kanssa, ja ilmoitus on koko taulukon levyinen
    assert.match(p.elements['s-pi'].innerHTML, /Kallein<\/td><td class="t bg">Ohjauksen keskihinta<\/td><\/tr><tr><td colspan="4">Ei vielä tiedossa<\/td><\/tr>$/);
    assert.match(p.elements['s-pa'].innerHTML, /<td colspan="3">Ei vielä tiedossa/, 'hintataulukossa on kolme saraketta');
  });

  test('taulukko on kahdessa palstassa: 00-12 ja 12-24', () => {
    for (const [q, half] of [[0, 12], [2, 24], [1, 48]]) {
      const p = page(boot({ start: '2026-10-06T16:00:00', inst: { mode: 1, m1: { l: 5 }, q }, price }));
      assert.equal(p.rows('s-pa').length, half, `tarkkuus ${q}`);
      assert.equal(p.rows('s-pb').length, half, `tarkkuus ${q}`);
      assert.equal(p.rows('s-pa')[0], '00:00');
      assert.equal(p.rows('s-pb')[0], '12:00');
      assert.match(p.elements['s-pb'].innerHTML, /Aika/, 'toisellakin palstalla on otsikkorivi');
    }
  });
});

describe('tilasivun ohjausennuste vastaa laitteen ohjausta: kausisiirto (v10)', () => {
  //Hinnat vaihtelevat tunneittain, joten siirtomaksun ero näkyy halvimpien tuntien valinnassa
  const price = (e, d) => Math.round(Math.sin(d.getHours() * 0.9) * 20 + 40) / 10;

  function compareDay(day, inst, common) {
    const prev = new Date(new Date(`${day}T12:00:00`).getTime() - 864e5);
    const pad = (n) => String(n).padStart(2, '0');
    const sim = boot({ start: `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-${pad(prev.getDate())}T23:50:00`, inst, price, common: Object.assign({ vat: 0, day: 6, night: 1 }, common) });
    sim.advanceTo(`${day}T00:05:00`);
    const predicted = uiPrediction(sim.status(0), 0, sim.now().getTime());
    const actual = inst.q ? runDaySlots(sim, day) : runDay(sim, day);
    assert.deepEqual(predicted, actual, 'käyttöliittymän näyttämä ohjaus poikkeaa laitteen ohjauksesta');
    return actual;
  }

  const CHEAP = { mode: 2, m2: { p: 24, c: 8 } };

  test('talven arkipäivä ja sunnuntai: ennuste vastaa laitetta, ja sunnuntaina päivätunteja valitaan', () => {
    const weekday = compareDay('2026-11-03', CHEAP, { tt: 1 });
    const sunday = compareDay('2026-11-08', CHEAP, { tt: 1 });
    const dayHours = (a) => a.slice(7, 22).reduce((s, v) => s + v, 0);
    assert.ok(dayHours(sunday) > dayHours(weekday), `päivätunteja sunnuntaina ${dayHours(sunday)}, arkena ${dayHours(weekday)}`);
  });

  test('kesäkausi, hintaraja ja vuodenvaihde', () => {
    compareDay('2026-10-06', CHEAP, { tt: 1 });
    compareDay('2026-11-03', { mode: 1, m1: { l: 6 } }, { tt: 1 });
    compareDay('2027-01-01', CHEAP, { tt: 1 });
  });

  test('omat kellonajat ja kausi', () => {
    compareDay('2026-07-07', CHEAP, { tt: 1, ss: 601, se: 831, ds: 6, de: 23 });
    compareDay('2026-10-06', CHEAP, { ds: 9, de: 17 });
  });

  test('muut kaudet ja kellonajat (10.10.-15.2. klo 09-14, 10.8.-29.2. klo 06-18)', () => {
    const a = { tt: 1, ss: 1010, se: 215, ds: 9, de: 14 };
    const b = { tt: 1, ss: 810, se: 229, ds: 6, de: 18 };
    for (const [day, common] of [['2026-10-10', a], ['2026-10-11', a], ['2027-02-15', a], ['2027-02-16', a],
      ['2026-08-10', b], ['2027-03-01', b], ['2028-02-29', b]]) {
      compareDay(day, CHEAP, common);
      compareDay(day, { mode: 1, m1: { l: 6 } }, common);
    }
  });

  test('15 minuutin tarkkuus', () => {
    compareDay('2026-11-03', { mode: 2, m2: { p: 24, c: 8 }, q: 1 }, { tt: 1 });
  });
});
