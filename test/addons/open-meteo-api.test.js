/**
 * Lisäosa shelly-porssisahko-open-meteo-api.js: halvimpien tuntien määrä Open-Meteo-palvelun sääennusteen mukaan
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { boot, assertAlive, runDay, hours, DAY_BEFORE, DAY } = require('../helpers');
const { loadAddon } = require('../sim/addon-alone');

const script = 'shelly-porssisahko-open-meteo-api.js';

describe(`${script}: yksin`, () => {
  /** Sääpalvelun vastaus: päivän alin lämpötila */
  const forecast = (min) => ({ code: 200, body: JSON.stringify({ daily: { temperature_2m_min: [min], temperature_2m_max: [min + 8] } }) });
  /** Lisäosa, jolle pääskripti on lukenut asetukset: 2 tuntia, 60 minuuttia */
  const load = () => {
    const addon = loadAddon(script, { config: [{ m2: { c: 2 }, m: 60 }] });
    addon.config(0, true);
    return addon;
  };

  test('lisäosa käyttää USER_CONFIG- ja USER_OVERRIDE-rajapintoja', () => {
    const addon = loadAddon(script);
    assert.equal(addon.has('USER_CONFIG'), true);
    assert.equal(addon.has('USER_OVERRIDE'), true);
  });

  test('ensimmäisellä logiikan ajolla haetaan ennuste oikeasta osoitteesta', () => {
    const addon = load();
    const res = addon.override(0, true);

    assert.equal(res.count, 0, 'pääskriptille vastataan vasta, kun ennuste on saatu');
    assert.equal(addon.calls.length, 1);
    assert.equal(addon.calls[0].method, 'HTTP.GET');
    assert.match(addon.calls[0].params.url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=61\.4991&longitude=23\.7871&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1$/);
  });

  const cases = [
    //[päivän alin lämpötila, tunnit, minuutit]
    [5, 2, 60], [-4.9, 2, 60], [-5, 6, 45], [-9.9, 6, 45], [-10, 7, 45], [-14.9, 7, 45], [-15, 8, 60], [-28, 8, 60]
  ];

  for (const [min, h, m] of cases) {
    test(`kylmintä ${min} °C -> ${h} tuntia, ${m} minuuttia`, () => {
      const addon = load();
      const res = addon.override(0, true);
      addon.respond(forecast(min));

      assert.equal(res.count, 1);
      assert.equal(res.value, null, 'pääskriptiä pyydetään ajamaan logiikka uudelleen uusilla asetuksilla');
      assert.equal(addon.state.c.i[0].m2.c, h);
      assert.equal(addon.state.c.i[0].m, m);
      assert.match(addon.state.si[0].str, new RegExp(`Kylmintä tänään: ${min.toFixed(1)}°C -> halvat tunnit: ${h} h, ohjaus: ${m} min`));
    });
  }

  test('samana päivänä ennustetta ei haeta uudelleen', () => {
    const addon = load();
    addon.override(0, true);
    addon.respond(forecast(-12));

    for (const cmd of [true, false]) {
      const res = addon.override(0, cmd);
      assert.equal(res.count, 1);
      assert.equal(res.value, cmd, 'pörssiohjaus sellaisenaan');
    }
    assert.equal(addon.calls.length, 0);
  });

  test('seuraavana päivänä ennuste haetaan uudelleen', () => {
    const addon = load();
    addon.override(0, true);
    addon.respond(forecast(-12));

    addon.advance(24 * 3600e3);
    const res = addon.override(0, true);
    assert.equal(res.count, 0);
    assert.equal(addon.calls.length, 1);
  });

  test('asetusten tallennus hakee ennusteen uudelleen ja käyttää uusia arvoja pohjana', () => {
    const addon = load();
    addon.override(0, true);
    addon.respond(forecast(3));

    addon.state.c.i[0].m2.c = 5;
    addon.config(0, true);
    addon.override(0, true);
    assert.equal(addon.calls.length, 1);
    addon.respond(forecast(3));
    assert.equal(addon.state.c.i[0].m2.c, 5);
  });

  const failures = {
    'verkkovirhe': (addon) => addon.respond(null, -1, 'Connection error'),
    'virhekoodi 500': (addon) => addon.respond({ code: 500, body: 'Internal Server Error' }),
    'tyhjä vastaus': (addon) => addon.respond({ code: 200, body: '' }),
    'rikkinäinen JSON': (addon) => addon.respond({ code: 200, body: '{"daily":' }),
    'vastauksesta puuttuu lämpötila': (addon) => addon.respond({ code: 200, body: JSON.stringify({ daily: {} }) }),
    'vastauksesta puuttuu daily': (addon) => addon.respond({ code: 200, body: JSON.stringify({ error: true, reason: 'Latitude must be in range' }) })
  };

  for (const name in failures) {
    test(`haku epäonnistuu (${name}): ohjataan käyttäjän arvoilla ja yritetään seuraavalla ajolla uudelleen`, () => {
      const addon = load();
      let res = addon.override(0, true);
      failures[name](addon);

      assert.equal(res.count, 1);
      assert.equal(res.value, null, 'logiikka ajetaan uudelleen');
      assert.match(addon.state.si[0].str, /^Virhe lämpötilaohjauksessa:/);
      assert.equal(addon.state.c.i[0].m2.c, 2);
      assert.equal(addon.state.c.i[0].m, 60);

      //Uusi ajo heti perään: ei uutta hakua, ohjataan asetusten mukaan
      res = addon.override(0, true);
      assert.equal(res.count, 1);
      assert.equal(res.value, true);
      assert.equal(addon.calls.length, 0);

      //Seuraava logiikan ajo (esim. tunnin vaihtuessa): haetaan uudelleen
      res = addon.override(0, true);
      assert.equal(res.count, 0);
      assert.equal(addon.calls.length, 1);
      addon.respond(forecast(-12));
      assert.equal(addon.state.c.i[0].m2.c, 7);
    });
  }

  test('muihin ohjauksiin ei kosketa', () => {
    const addon = load();
    const res = addon.override(1, true);
    assert.equal(res.count, 1);
    assert.equal(res.value, true);
    assert.equal(addon.calls.length, 0);
    assert.equal(addon.state.c.i[1].m2.c, 4);
  });
});

describe(`${script}: pääskriptin kanssa`, () => {
  const forecast = (min) => () => ({ body: { daily: { temperature_2m_min: [min], temperature_2m_max: [min + 8] } } });

  test('ennusteen mukaan säädetään tuntimäärää', () => {
    const sim = boot({ script, inst: { mode: 2, m2: { p: 24, c: 2 } }, settle: false });
    sim.net.other = forecast(-12);
    sim.settle();
    assertAlive(sim);

    assert.equal(sim.otherHttpLog.length, 1);
    assert.match(sim.otherHttpLog[0].url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=/);
    assert.equal(sim.evaluate('_.c.i[0].m2.c'), 7);
    assert.equal(sim.evaluate('_.c.i[0].m'), 45);
    assert.match(sim.status(0).si.str, /-12\.0°C/);
  });

  test('ennuste haetaan kerran vuorokaudessa', () => {
    const sim = boot({ script, start: DAY_BEFORE, inst: { mode: 2, m2: { p: 24, c: 2 } }, settle: false });
    sim.net.other = forecast(0);
    sim.settle();
    assert.equal(sim.otherHttpLog.length, 1);

    runDay(sim, DAY);
    assert.equal(sim.otherHttpLog.length, 2);
  });

  test('leudolla säällä käytetään asetettua tuntimäärää', () => {
    const sim = boot({ script, start: DAY_BEFORE, inst: { mode: 2, m2: { p: 24, c: 2 } }, settle: false });
    sim.net.other = forecast(3);

    assert.deepEqual(runDay(sim, DAY), hours([2, 3]));
  });
});
