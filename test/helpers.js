/**
 * Testien yhteiset apufunktiot
 */
const assert = require('node:assert/strict');
const { createSim } = require('./sim/shelly-sim');

/**
 * Käynnistää simulaattorin niin, että ohjaus #1 on käytössä annetuilla asetuksilla.
 * ALV ja siirtohinnat ovat oletuksena 0, jolloin hinnat vastaavat suoraan hintafunktion arvoja.
 *
 * @param {object} opts createSim-asetukset sekä:
 * @param {object} opts.inst ohjauksen #1 asetukset
 * @param {object} opts.common yleiset asetukset
 * @param {boolean} opts.settle false = ei odoteta käynnistyksen valmistumista
 */
function boot(opts = {}) {
  const sim = createSim(Object.assign({}, opts, {
    kvs: Object.assign({
      'porssi': Object.assign({ vat: 0, day: 0, night: 0 }, opts.common),
      'porssi-1': Object.assign({ en: 1 }, opts.inst)
    }, opts.kvs)
  }));

  if (opts.settle !== false) {
    sim.settle();
    assertAlive(sim);
  }

  return sim;
}

/** Varmistaa, ettei skripti ole pysähtynyt käsittelemättömään virheeseen */
function assertAlive(sim) {
  assert.equal(sim.crashed, null, 'skripti pysähtyi: ' + (sim.crashed && sim.crashed.stack));
}

/**
 * Ajaa yhden vuorokauden ja palauttaa lähdön tilan jokaiselta tunnilta (näyte otetaan hh:30).
 * Simulaattorin pitää olla käynnistetty ennen kyseisen päivän alkua.
 *
 * @returns {number[]} 24 arvoa, 1 = päällä
 */
function runDay(sim, date, output = 0) {
  let res = [];

  for (let h = 0; h < 24; h++) {
    sim.advanceTo(`${date}T${String(h).padStart(2, '0')}:30:00`);
    res.push(sim.relays[output] ? 1 : 0);
  }

  assertAlive(sim);
  return res;
}

/**
 * Kuten runDay, mutta näyte jokaiselta 15 minuutin jaksolta (klo xx:07, xx:22, xx:37, xx:52)
 *
 * @returns {number[]} 96 arvoa, 1 = päällä
 */
function runDaySlots(sim, date, output = 0) {
  let res = [];

  for (let i = 0; i < 96; i++) {
    let h = String(Math.floor(i / 4)).padStart(2, '0');
    let m = String((i % 4) * 15 + 7).padStart(2, '0');
    sim.advanceTo(`${date}T${h}:${m}:00`);
    res.push(sim.relays[output] ? 1 : 0);
  }

  assertAlive(sim);
  return res;
}

/** Jaksolista 96 arvon taulukoksi: slots(['02:15', '13:00']) */
function slots(list) {
  let res = new Array(96).fill(0);
  list.forEach(t => {
    let [h, m] = t.split(':').map(Number);
    res[h * 4 + m / 15] = 1;
  });
  return res;
}

/** Aikaväli jaksolistaksi: range('02:30', '03:30') -> ['02:30', '02:45', '03:00', '03:15'] */
function range(from, to) {
  let toIndex = (t) => { let [h, m] = t.split(':').map(Number); return h * 4 + m / 15; };
  let res = [];
  for (let i = toIndex(from); i < toIndex(to); i++) {
    res.push(`${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
  }
  return res;
}

/** Tiivis esitys vertailuvirheisiin: päällä olevien jaksojen kellonajat */
function onTimes(values) {
  return values.map((v, i) => v ? `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}` : null).filter(v => v).join(' ');
}

/** Muuttaa tuntilistan 24 arvon taulukoksi: hours([1, 2]) -> [0, 1, 1, 0, ...] */
function hours(list) {
  let res = new Array(24).fill(0);
  list.forEach(h => res[h] = 1);
  return res;
}

/** Tuntilista bittimaskiksi (varmuustunnit ja pakko-ohjatut tunnit) */
function mask(list) {
  return list.reduce((m, h) => m | (1 << h), 0);
}

/** Liukulukujen vertailu */
function near(actual, expected, msg) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${msg ?? 'arvo'}: ${actual} != ${expected}`);
}

/** Päivä, jota ennen simulaattori käynnistetään runDay-testeissä */
const DAY_BEFORE = '2026-10-05T23:50:00';
const DAY = '2026-10-06';

module.exports = { boot, assertAlive, runDay, runDaySlots, slots, range, onTimes, hours, mask, near, DAY_BEFORE, DAY };
