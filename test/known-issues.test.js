/**
 * Aiemmin tunnetut ongelmat ja kehitysideat.
 *
 * Testit kuvaavat toivotun käyttäytymisen. Ne kirjoitettiin ensin todo-testeiksi,
 * jotka toistivat simulaattorissa löydetyt viat, ja todo-merkintä poistettiin
 * sitä mukaa kuin viat korjattiin. Kaikki tämän tiedoston viat on nyt korjattu,
 * ja testit varmistavat, etteivät ne palaa.
 *
 * Uuden löydetyn vian voi lisätä tänne todo-testinä: testi ajetaan, mutta sen
 * epäonnistuminen ei kaada testiajoa.
 *
 *   test('kuvaus toivotusta toiminnasta', todo, () => { ... });
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { boot, assertAlive, runDay, hours, DAY_BEFORE, DAY } = require('./helpers');
const { createSim, kvsLength, kvsSwap, kvsPack } = require('./sim/shelly-sim');
const { DEFAULT_HOURLY } = require('./sim/elering');

const todo = { todo: true };

describe('vanhat hinnat varalla kun haku epäonnistuu (toteutettu)', () => {
  test('asetusten tallennus nettikatkon aikana ei hukkaa tämän päivän hintoja', () => {
    const sim = boot({ start: '2026-10-05T02:10:00', inst: { mode: 1, m1: { l: 5 } } });
    assert.equal(sim.relays[0], true);

    sim.net.mode = 'error';
    sim.saveConfig(0, { m1: { l: 4 } });
    sim.advance(10 * 60e3);

    const st = sim.status(0);
    assert.equal(sim.rows(0).length, 24, 'hinnat ovat edelleen muistissa');
    assert.equal(st.si.st, 2, 'ohjaus perustuu hintaan, ei varmuustunteihin');
    assert.equal(sim.relays[0], true);
  });

  test('vuorokauden vaihtuessa käytetään jo haettuja huomisen hintoja, jos haku epäonnistuu', () => {
    const sim = boot({ start: '2026-10-05T18:00:00', inst: { mode: 2, m2: { p: 24, c: 4 } } });
    assert.equal(sim.rows(1).length, 24);

    sim.net.mode = 'error';
    assert.deepEqual(runDay(sim, DAY), hours([1, 2, 3, 4]));
    assert.equal(sim.rows(0).length, 24);
  });

  test('vuorokauden vaihtuessa hinnat päivitetään silti, kun haku onnistuu', () => {
    //Nykyinen toiminta (v2.13.0, issue #26), jonka pitää säilyä myös varajärjestelyn kanssa
    let corrected = false;
    const price = (e, d) => corrected ? 1 : DEFAULT_HOURLY[d.getHours()];
    const sim = boot({ start: '2026-10-05T18:00:00', price });

    corrected = true;
    sim.advanceTo('2026-10-06T00:04:00');
    assert.equal(sim.rows(0)[12][1], 1);
  });
});

describe('kesä- ja talviaika', () => {
  //25.10.2026 klo 04:00 kesäaikaa -> 03:00 talviaikaa, eli tunti 03-04 toistuu.
  //Skripti yhdistää molemmat 03-tunnit yhdeksi hintariviksi, jonka aikaleima on ensimmäisen tunnin alku.

  test('talviaikaan siirryttäessä ohjaus säilyy toistuvan tunnin 03-04 yli', () => {
    //Nykyinen toiminta: logiikkaa ei ajeta toisen 03-tunnin alussa (tunnin numero ei muutu),
    //joten lähtö pysyy ensimmäisen 03-tunnin tilassa
    const sim = boot({ start: '2026-10-25T00:30:00', inst: { mode: 1, m1: { l: 999 }, e: 0 } });

    sim.advanceTo('2026-10-25T03:30:00+03:00');
    assert.equal(sim.relays[0], true, '03:30 kesäaikaa');

    sim.advanceTo('2026-10-25T03:30:00+02:00');
    assertAlive(sim);
    assert.equal(sim.relays[0], true, '03:30 talviaikaa');
    assert.equal(sim.status(0).s.errCnt, 0);
  });

  test('käynnistys toistuvan tunnin 03-04 (talviaikaa) aikana ohjaa hinnan mukaan', () => {
    //Korjattu: hinnat tallennetaan jaksoittain alkuhetkestä laskien, joten toistuva tunti löytyy hinnoista
    const sim = boot({ start: '2026-10-25T03:10:00+02:00', inst: { mode: 1, m1: { l: 999 }, e: 0 }, settle: false });
    sim.advance(10 * 60e3);

    assertAlive(sim);
    assert.equal(sim.evaluate('_.si[0].st'), 2, 'ohjaus perustuu hintaan');
    assert.equal(sim.relays[0], true);
    assert.ok(sim.fetchCount() <= 2, `hintoja haettiin ${sim.fetchCount()} kertaa 10 minuutissa`);
  });

  test('aikavyöhykkeen vaihtuessa ohjaus ei käy varmuustuntiohjauksella', () => {
    //Korjattu: aikavyöhykkeen muuttuessa hinnat haetaan uudelleen, mutta vanhat pysyvät käytössä siihen asti
    const sim = boot({ start: '2026-10-25T00:30:00', inst: { mode: 1, m1: { l: 999 }, b: 0 } });

    sim.advanceTo('2026-10-25T04:05:00+02:00');
    assertAlive(sim);
    assert.equal(sim.relays[0], true);
    assert.deepEqual(sim.switchLog.filter(s => !s.on), [], 'lähtöä ei ohjattu välillä pois');
  });

  test('talviaikaan siirtymispäivänä jokaisella 25 tunnilla ohjataan hinnan mukaan', () => {
    //Shelly tuntee vain nykyhetken aikavyöhykkeen, joten ennen kellonsiirtoa haetuista hinnoista
    //puuttuu päivän viimeinen tunti. Kellonsiirron jälkeen hinnat haetaan uudelleen oikealla aikavälillä.
    const sim = boot({ start: '2026-10-25T00:30:00', inst: { mode: 1, m1: { l: 999 }, b: 0 } });
    const start = sim.now().getTime();

    for (let h = 0; h < 25; h++) {
      sim.advanceTo(new Date(start + h * 3600e3));
      assertAlive(sim);
      assert.equal(sim.status(0).si.st, 2, `tunti ${h}: ohjaus perustuu hintaan`);
      assert.equal(sim.relays[0], true, `tunti ${h}`);
    }

    //Viimeinen näyte on 23:30 talviaikaa
    assert.equal(sim.now().getHours(), 23);
    assert.equal(sim.status(0).s.errTot, 0);

    const rows = sim.rows(0);
    assert.equal(new Date(rows[rows.length - 1][0] * 1000).toISOString(), '2026-10-25T21:00:00.000Z', 'hinnat kattavat klo 23-24 talviaikaa');
  });

  test('talviaikaan siirtymispäivänä toistuvalla tunnilla ajetaan logiikka', () => {
    //Tunti 03-04 on halpa kesäajalla (ensimmäinen kerta) ja kallis talviajalla (toinen kerta)
    const second = Math.floor(new Date('2026-10-25T03:00:00+02:00').getTime() / 1000);
    const price = (e) => (e >= second && e < second + 3600) ? 50 : 1;
    const sim = boot({ start: '2026-10-25T00:30:00', inst: { mode: 1, m1: { l: 10 } }, price });

    sim.advanceTo('2026-10-25T03:30:00+03:00');
    assert.equal(sim.relays[0], true, '03:30 kesäaikaa: halpa');

    sim.advanceTo('2026-10-25T03:30:00+02:00');
    assert.equal(sim.relays[0], false, '03:30 talviaikaa: kallis');

    sim.advanceTo('2026-10-25T04:30:00+02:00');
    assert.equal(sim.relays[0], true, '04:30 talviaikaa: halpa');
  });

  test('kesäaikaan siirtymispäivänä ennen kellonsiirtoa haetuissa hinnoissa ei ole seuraavan päivän tuntia', () => {
    //Klo 00:30 laite käyttää talviajan aikavyöhykettä, jolloin pyynnön aikaväli ulottuu tunnin seuraavan päivän puolelle
    const sim = boot({ start: '2026-03-29T00:30:00', inst: { mode: 2, m2: { p: 24, c: 23 } } });

    assert.equal(sim.status(0).p[0].length, 92);
    assert.ok(sim.rows(0).every(row => new Date(row[0] * 1000).getDate() === 29));

    //Kellonsiirron jälkeenkin sama päivä, ja ohjaus toimii koko päivän
    sim.advanceTo('2026-03-29T05:30:00');
    assert.equal(sim.status(0).p[0].length, 92);
    assert.ok(sim.rows(0).every(row => new Date(row[0] * 1000).getDate() === 29));

    sim.advanceTo('2026-03-29T23:30:00');
    assertAlive(sim);
    assert.equal(sim.status(0).si.st, 5);
    assert.equal(sim.status(0).s.errTot, 0);
  });

  test('tuntematon päivämäärämuoto hintadatassa: kaikki rivit käytetään', () => {
    const { eleringCsv } = require('./sim/elering');
    const sim = boot({ start: '2026-10-05T10:00:00', settle: false });
    sim.net.body = (url) => eleringCsv(url, sim.net).replace(/"(\d\d)\.(\d\d)\.(\d{4}) (\d\d:\d\d)"/g, '"$3-$2-$1T$4:00"');
    sim.settle();

    assertAlive(sim);
    assert.equal(sim.status(0).p[0].length, 96);
    assert.equal(sim.status(0).s.errTot, 0);
  });

  test('kesäaikaan siirtymispäivän hinnoissa on vain kyseisen päivän 23 tuntia', () => {
    //29.3.2026 klo 03:00 talviaikaa -> 04:00 kesäaikaa
    const sim = boot({ start: '2026-03-29T10:00:00' });
    const p = sim.rows(0);

    assert.equal(p.length, 23);
    assert.ok(p.every(row => new Date(row[0] * 1000).getDate() === 29), 'kaikki tunnit ovat tältä päivältä');
  });
});

describe('skriptin jumiutuminen tai pysähtyminen ja asetusten lataus (korjattu)', () => {
  test('tyhjä lähtölista ei jätä skriptiä pysyvästi kiireiseksi', () => {
    //Mahdollista vain muokkaamalla asetuksia käsin KVS:ssä
    const sim = boot({ inst: { mode: 0, m0: { c: 1 } } });
    sim.writeKvs(0, { o: [] });
    sim.request('r=r&i=0');
    sim.advance(5 * 60e3);

    assertAlive(sim);
    assert.equal(sim.request('r=s&i=0').code, 200);
  });

  test('virheellinen JSON KVS:ssä ei pysäytä skriptiä', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 } } });
    sim.kvs.set('porssisahko-1', '{virheellinen');
    sim.request('r=r&i=0');
    sim.settle(60000);

    assertAlive(sim);
    assert.equal(sim.request('r=s&i=0').code, 200);
  });

  test('virheellinen JSON KVS:ssä käynnistyksessä: käytetään oletusasetuksia', () => {
    const sim = boot({ kvs: { 'porssi-1': '{virheellinen', 'porssi-2': { en: 1, mode: 0, m0: { c: 1 }, o: [1] } } });
    sim.settle(60000);

    assertAlive(sim);
    assert.ok(sim.logLines().some(l => l.includes('invalid config porssi-1')));
    assert.equal(sim.status(0).ci.en, 0, 'ohjaus #1 on oletuksilla eli pois käytöstä');
    assert.equal(sim.status(0).ci.m2.p, 24);
    assert.equal(sim.relays[1], true, 'muut ohjaukset toimivat');
    assert.equal(sim.kvs.get('porssi-1'), '{virheellinen', 'KVS:n sisältöä ei ylikirjoiteta');
  });

  test('virheelliset yleiset asetukset KVS:ssä: käytetään oletuksia tai edellisiä asetuksia', () => {
    const sim = boot({ kvs: { 'porssi': 'ei jsonia' }, inst: { mode: 0, m0: { c: 1 } } });
    assertAlive(sim);
    assert.equal(sim.status(0).c.vat, 25.5);
    assert.equal(sim.relays[0], true);
    assert.equal(sim.rows(0).length, 24, 'hinnat haetaan oletusmaalla');

    //Ajon aikana rikkoutunut asetus: edelliset arvot jäävät voimaan
    sim.kvs.set('porssisahko', "[1,'fi',10,0,0,['-','-','-']]");
    sim.get('r=r&i=0');
    sim.settle();
    assert.equal(sim.status(0).c.vat, 10);
    sim.kvs.set('porssisahko', '[1, 2');
    sim.get('r=r&i=0');
    sim.settle();
    assertAlive(sim);
    assert.equal(sim.status(0).c.vat, 10);
  });

  test('KVS:ssä oleva arvo ei ole olio: asetus ohitetaan', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 } } });
    //Kelvollinen arvo on lista, jonka ensimmäinen arvo on muodon versio 1
    for (const value of ['5', 'null', "'teksti'", 'true', '{}', '[]', '[2,1,0,[0]]', "{'en':1}"]) {
      sim.kvs.set('porssisahko-1', value);
      sim.get('r=r&i=0');
      sim.settle();
      assertAlive(sim);
      assert.equal(sim.status(0).ci.m0.c, 1, `arvo ${value}`);
    }
  });

  test('r=r olemattomalla ohjauksen numerolla ei pysäytä skriptiä', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 0 } } });
    sim.writeKvs(0, { m0: { c: 1 } });
    for (const query of ['r=r&i=7', 'r=r&i=-3', 'r=r&i=abc', 'r=r&i=']) {
      assert.equal(sim.get(query).code, 204, query);
      sim.settle();
      assertAlive(sim);
    }
    assert.equal(sim.relays[0], true, 'asetukset ladattiin');
  });

  test('tyhjä lähtölista säilyy tyhjänä myös käynnistyksessä', () => {
    //Tyhjä lista tarkoittaa "ei lähtöjä" - sitä ei täydennetä oletuslähdöksi 0
    const sim = boot({ inst: { mode: 0, m0: { c: 1 }, o: [] } });
    sim.advance(3 * 3600e3);

    assertAlive(sim);
    assert.deepEqual(sim.status(0).ci.o, []);
    assert.equal(sim.switchLog.length, 0);
    assert.equal(sim.status(0).si.cmd, 1, 'logiikka ajetaan silti');
    assert.deepEqual(sim.cfg(0).o, []);
  });

  test('puuttuva lähtölista saa oletuksen 0', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 } } });
    assert.deepEqual(sim.status(0).ci.o, [0]);
    assert.equal(sim.relays[0], true);
  });

  test('liian lyhyt tai virheellinen nimilista täydennetään ohjausten määrään', () => {
    for (const names of [[], ['Varaaja'], 'teksti', 5]) {
      const sim = boot({ common: { names } });
      assertAlive(sim);
      const res = sim.status(0).c.names;
      assert.equal(res.length, 3, JSON.stringify(names));
      assert.equal(res[2], '-');
      if (Array.isArray(names) && names.length) {
        assert.equal(res[0], 'Varaaja');
      }
    }
  });

  test('tyhjä lähtölista: logiikka ajetaan, mutta lähtöihin ei kosketa', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 } } });
    const writes = sim.switchLog.length;
    sim.writeKvs(0, { o: [] });
    sim.get('r=r&i=0');
    sim.advance(3 * 3600e3);

    assertAlive(sim);
    assert.equal(sim.switchLog.length, writes);
    assert.equal(sim.status(0).si.cmd, 1);
    assert.ok(sim.status(0).si.chkTs > 0);
  });

  test('puutteellinen asetus KVS:ssä täydennetään myös uudelleenlatauksessa', () => {
    //Korjattu: puuttuvat arvot otetaan edellisestä voimassa olleesta asetuksesta
    //(oletusasetukset poistetaan muistista ensimmäisen tarkistuksen jälkeen)
    const sim = boot({ inst: { mode: 0, m0: { c: 0 } } });
    //Listan lopusta puuttuvat arvot: käytössä, käsiohjaus, käsiohjaus päällä
    sim.kvs.set('porssisahko-1', '[1,1,0,[1]]');
    sim.request('r=r&i=0');
    sim.settle(60000);

    assertAlive(sim);
    assert.equal(sim.relays[0], true);
  });

  test('r=r ilman ohjauksen numeroa lataa kaikki asetukset', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 0 } } });
    sim.writeKvs(0, { m0: { c: 1 } });
    sim.request('r=r');
    sim.settle(60000);

    assertAlive(sim);
    assert.equal(sim.relays[0], true);
  });

  test('useita latauspyyntöjä kiireisenä: kaikki ohjaukset ladataan', () => {
    const sim = boot({
      start: '2026-10-05T14:59:00',
      inst: { mode: 0, m0: { c: 0 }, o: [0] },
      kvs: { 'porssi-2': { en: 1, mode: 0, m0: { c: 0 }, o: [1] }, 'porssi-3': { en: 1, mode: 0, m0: { c: 0 }, o: [2] } }
    });
    sim.net.delay = 3000;
    //Huomisen hintojen haku alkaa laitekohtaisen viiveen (simulaattorissa 180 s) jälkeen kierroksella klo 15:03:00
    sim.advanceTo('2026-10-05T15:03:01');
    assert.equal(sim.request('r=s&i=0').code, 503, 'skripti on kiireinen');

    sim.writeKvs(0, { m0: { c: 1 } });
    assert.equal(sim.request('r=r&i=0').code, 204);
    sim.writeKvs(2, { m0: { c: 1 } });
    assert.equal(sim.request('r=r&i=2').code, 204);

    sim.settle(60000);
    assertAlive(sim);
    assert.deepEqual(sim.relays, { 0: true, 1: false, 2: true });
  });

  test('lähtölistan lyhentäminen ei yhdisty vanhaan listaan', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 }, o: [0, 2] } });
    assert.deepEqual(sim.relays, { 0: true, 2: true });

    sim.saveConfig(0, { o: [1] });
    assert.deepEqual(sim.status(0).ci.o, [1]);
    assert.equal(sim.relays[1], true);
  });

  test('vajaat yleiset asetukset täydennetään edellisistä', () => {
    const sim = boot({ common: { vat: 10, day: 2, names: ['Varaaja', '-', '-'] }, inst: { mode: 0, m0: { c: 1 } } });
    //Listan lopusta puuttuvat siirtomaksut, nimet, määrä ja historian pituus
    sim.kvs.set('porssisahko', "[1,'fi',20]");
    sim.get('r=r&i=0');
    sim.settle();

    assertAlive(sim);
    const c = sim.status(0).c;
    assert.equal(c.vat, 20, 'annettu arvo tulee voimaan');
    assert.equal(c.day, 2, 'puuttuva arvo säilyy');
    assert.equal(c.g, 'fi');
    assert.deepEqual(c.names, ['Varaaja', '-', '-']);
    assert.equal(sim.cfg(-1).day, 2, 'täydennetty asetus tallennetaan');
  });

  test('asetusten latauspyyntö ei huku, vaikka skripti on kiireinen', () => {
    //Korjattu: latauspyyntö hyväksytään aina ja käsitellään, kun skripti vapautuu
    const sim = boot({ start: '2026-10-05T14:59:00', inst: { mode: 0, m0: { c: 0 } } });
    sim.net.delay = 3000;

    //Huomisen hintojen haku on käynnissä
    sim.advanceTo('2026-10-05T15:00:01');
    sim.writeKvs(0, { m0: { c: 1 } });
    assert.equal(sim.request('r=r&i=0').code, 204, 'latauspyyntö hyväksytään');

    sim.settle(60000);
    assert.equal(sim.relays[0], true);
  });
});

describe('muut havainnot (korjattu)', () => {
  test('uudessa asennuksessa ohjauksilla on omat asetusoliot', () => {
    //Uudessa asennuksessa on yksi ohjaus - määrä nostetaan kolmeen, jolloin loput luodaan oletuksista
    const sim = createSim();
    sim.settle();
    sim.saveConfig(-1, {}, { cnt: 3 });

    assert.equal(sim.evaluate('_.c.i[0].m2 === _.c.i[1].m2'), false);
    assert.equal(sim.evaluate('_.c.i[0].o === _.c.i[1].o'), false);
  });

  test('1-instance-no-history: historia ei kasva rajatta', () => {
    const price = (e, d) => d.getHours() % 2;
    const sim = boot({
      script: 'shelly-porssisahko-1-instance-no-history.js',
      start: DAY_BEFORE, inst: { mode: 1, m1: { l: 0 } }, price
    });
    runDay(sim, DAY);
    runDay(sim, '2026-10-07');

    assert.equal(sim.evaluate('_.h[0]'), '', 'historiaa ei kerätä');
    assert.deepEqual(sim.history(0), []);
  });

  test('ht-sensor-temp: yli 12 h vanhaa lämpötilaa ei käytetä', () => {
    const sim = boot({
      script: 'shelly-porssisahko-ht-sensor-temp.js',
      start: '2026-10-05T10:00:00', inst: { mode: 2, m2: { p: 24, c: 2 } }
    });
    sim.request('temp=-20', 'update-temp');
    sim.settle();
    assert.equal(sim.evaluate('_.c.i[0].m2.c'), 8);

    sim.advanceTo('2026-10-06T10:30:00');
    assert.equal(sim.evaluate('_.c.i[0].m2.c'), 2, 'vanhentunut lämpötila -> alkuperäinen tuntimäärä');
  });

  test('open-meteo-api: lähtöä ohjataan, vaikka sääennustetta ei saada', () => {
    //net.other ei ole asetettu -> Open-Meteo vastaa 404
    const sim = boot({
      script: 'shelly-porssisahko-open-meteo-api.js',
      inst: { mode: 0, m0: { c: 1 } }
    });
    sim.advance(5 * 60e3);

    assertAlive(sim);
    assert.equal(sim.relays[0], true);
    assert.ok(sim.otherHttpLog.length <= 5, `ennustetta haettiin ${sim.otherHttpLog.length} kertaa 5 minuutissa`);
  });

  test('open-meteo-api: ennuste haetaan uudelleen seuraavalla logiikan ajolla', () => {
    const sim = boot({
      script: 'shelly-porssisahko-open-meteo-api.js',
      start: '2026-10-05T10:10:00',
      inst: { mode: 2, m2: { p: 24, c: 2 } }
    });
    assert.equal(sim.otherHttpLog.length, 1, 'yksi epäonnistunut haku käynnistyksessä');
    assert.equal(sim.evaluate('_.c.i[0].m2.c'), 2, 'käytetään asetettua tuntimäärää');
    assert.ok(sim.status(0).si.chkTs > 0, 'ohjaus on tehty');

    //Samalla tunnilla ei haeta uudelleen
    sim.advanceTo('2026-10-05T10:55:00');
    assert.equal(sim.otherHttpLog.length, 1);

    //Seuraavalla tunnilla haetaan uudelleen (edelleen katko)
    sim.advanceTo('2026-10-05T11:05:00');
    assert.equal(sim.otherHttpLog.length, 2);
    assertAlive(sim);

    //Yhteys palaa -> seuraavalla tunnilla ennuste saadaan ja tuntimäärä muuttuu
    sim.net.other = () => ({ body: { daily: { temperature_2m_min: [-12], temperature_2m_max: [-4] } } });
    sim.advanceTo('2026-10-05T12:05:00');
    assert.equal(sim.otherHttpLog.length, 3);
    assert.equal(sim.evaluate('_.c.i[0].m2.c'), 7);

    //Sen jälkeen ei haeta enää samana päivänä
    sim.advanceTo('2026-10-05T14:05:00');
    assert.equal(sim.otherHttpLog.length, 3);
  });

  test('uudessa asennuksessa yhden ohjauksen muutos ei näy muissa', () => {
    //Lisäosa muuttaa ohjauksen #1 tuntimäärää muistissa heti ensimmäisellä käynnistyksellä
    const sim = createSim({
      user: 'function USER_CONFIG(inst, initialized) { if (inst == 0 && !initialized) { _.c.i[0].m2.c = 9; _.c.i[0].o.push(5); } }'
    });
    //Uudessa asennuksessa on yksi ohjaus - määrä nostetaan kolmeen, jolloin loput luodaan oletuksista
    sim.settle();
    sim.saveConfig(0, { en: 1, mode: 2 }, { cnt: 3 });

    assertAlive(sim);
    assert.equal(sim.evaluate('_.c.i[1].m2.c'), 0);
    assert.deepEqual(sim.evaluate('_.c.i[1].o'), [0]);
    assert.deepEqual(sim.evaluate('_.c.i[2].o'), [0]);
  });

  test('ht-sensor-temp: alle 12 h vanhaa lämpötilaa käytetään', () => {
    const sim = boot({
      script: 'shelly-porssisahko-ht-sensor-temp.js',
      start: '2026-10-05T10:00:00', inst: { mode: 2, m2: { p: 24, c: 2 } }
    });
    sim.request('temp=-20', 'update-temp');
    sim.advanceTo('2026-10-05T21:30:00');
    assert.equal(sim.evaluate('_.c.i[0].m2.c'), 8, '11,5 h vanha lämpötila kelpaa');
  });
});

describe('virheelliset asetukset eivät kaada tai jumita skriptiä (korjattu)', () => {
  //Käyttöliittymä ei kirjoita näitä arvoja, mutta KVS:ää voi muokata käsin
  const alive = (sim) => {
    assertAlive(sim);
    sim.advance(60e3);
    sim.settle();
    assert.equal(sim.get('r=s&i=0').code, 200, 'skripti vastaa');
    assert.ok(sim.status(0).si.chkTs > 0, 'logiikka on ajettu');
  };

  for (const p of [0, null, 'x', -3, 0.5]) {
    test(`jakson pituus ${JSON.stringify(p)} korvataan oletuksella 24`, () => {
      const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 2, m2: { p, c: 2 } } });
      alive(sim);
      assert.equal(sim.cfg(0).m2.p, 24);
    });
  }

  for (const p of [24, 1, -1, -2]) {
    test(`jakson pituus ${p} säilyy`, () => {
      const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 2, m2: { p, c: 1 } } });
      assert.equal(sim.status(0).ci.m2.p, p);
    });
  }

  test('lisäskriptin asettama jakson pituus 0 ei jumita logiikkaa', () => {
    const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 2, m2: { p: 24, c: 24 } } });
    assert.equal(sim.relays[0], true);
    sim.evaluate('(_.c.i[0].m2.p = 0, _.si[0].chkTs = 0)');
    alive(sim);
    assert.equal(sim.relays[0], false, 'ei halvimpia tunteja');
  });

  for (const o of [5, 'x', { a: 1 }, null]) {
    test(`lähdöt ${JSON.stringify(o)} (ei lista) korvataan oletuksella [0]`, () => {
      const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 0, m0: { c: 1 }, o } });
      alive(sim);
      assert.deepEqual(sim.cfg(0).o, [0]);
      assert.equal(sim.relays[0], true);
    });
  }

  test('tyhjä lähtölista säilyy', () => {
    const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 0, m0: { c: 1 }, o: [] } });
    alive(sim);
    assert.deepEqual(sim.status(0).ci.o, []);
  });

  for (const key of ['m0', 'm1', 'm2']) {
    for (const value of [null, 5, 'x', [1]]) {
      test(`${key}: ${JSON.stringify(value)} korvataan oletuksilla`, () => {
        const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 2, [key]: value } });
        alive(sim);
        const saved = sim.cfg(0);
        assert.equal(typeof saved[key], 'object');
        assert.equal(saved.m2.p, 24);
        assert.equal(saved.m1.l, 0);
        assert.equal(saved.m0.c, 0);
      });
    }
  }

  test('nimet väärää tyyppiä korvataan', () => {
    const sim = boot({ start: '2026-10-06T10:01:00', common: { names: 'Varaaja' } });
    alive(sim);
    assert.deepEqual(sim.status(0).c.names, ['-', '-', '-']);
  });

  test('virheellinen asetus ajon aikana: aiemmat arvot jäävät voimaan', () => {
    const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 2, m2: { p: 12, c: 3 }, o: [1] } });
    //Listassa jakson asetusten (m2) tilalla null ja lähtölistan tilalla luku
    const list = JSON.parse(kvsSwap(sim.kvs.get('porssisahko-1')));
    list[5] = null;
    list[8] = 7;
    sim.kvs.set('porssisahko-1', kvsSwap(JSON.stringify(list)));
    sim.get('r=r&i=0');
    sim.settle();
    alive(sim);
    assert.equal(sim.status(0).ci.m2.p, 12);
    assert.deepEqual(sim.status(0).ci.o, [1]);
  });

  test('tilasivun valintasilmukka päättyy vaikka jakson pituus olisi 0', () => {
    const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'statics', 'tab-status.js'), 'utf8');
    assert.match(source, /for \(let i = 0; inc > 0 && i - off < prices\.length; i \+= inc\)/);
  });
});

describe('hintakatko ei aiheuta turhia logiikka-ajoja (korjattu)', () => {
  const counts = (sim) => [sim.fetchCount(), sim.switchLog.length];

  test('vanhat hinnat käytössä: logiikka ajetaan vain tunnin vaihtuessa', () => {
    const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 1, m1: { l: 999 } } });
    sim.net.mode = 'error';
    sim.evaluate('_.s.p[0].ts = 0');
    sim.advanceTo('2026-10-06T10:10:00');

    const a = counts(sim);
    sim.advanceTo('2026-10-06T11:10:00');
    const b = counts(sim);

    //Uusintayritykset harvenevat 10 minuutin välein: tunnissa noin 6 yritystä
    assert.ok(b[0] - a[0] >= 5 && b[0] - a[0] <= 8, `hakua yritetään edelleen harvennetulla tahdilla: ${b[0] - a[0]}`);
    assert.equal(b[1] - a[1], 1, 'yksi relekirjoitus tunnissa');
    assert.equal(sim.status(0).si.st, 2, 'ohjaus vanhoilla hinnoilla');
    assert.equal(sim.relays[0], true);
  });

  test('ei hintoja lainkaan: varmuustunnit otetaan käyttöön kolmen epäonnistuneen haun jälkeen', () => {
    const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 1, m1: { l: 999 }, b: 1 << 10 }, settle: false });
    sim.net.mode = 'error';
    sim.advance(60e3);
    assert.equal(sim.status(0).si.st, 7);
    assert.equal(sim.relays[0], true);
  });

  test('haun onnistuttua logiikka ajetaan heti uusilla hinnoilla', () => {
    let cheap = false;
    const sim = boot({ start: '2026-10-06T10:01:00', inst: { mode: 1, m1: { l: 5 } }, price: () => cheap ? 1 : 10 });
    assert.equal(sim.relays[0], false);

    cheap = true;
    sim.evaluate('_.s.p[0].ts = 0');
    sim.advance(30e3);
    assert.equal(sim.relays[0], true);
  });
});

describe('asetusten tallennusmuoto: arvot listana omissa avaimissaan (korjattu)', () => {
  //Löytyi laitteella (laiteohjelmisto 2.0.1): Shelly sallii KVS-arvolle 253 tavua, mutta laskee jokaisen
  //merkin " kahtena. Asetusten nimillä JSON-tekstinä ohjauksen asetuksista mahtui vain 199 merkkiä, ja esimerkiksi
  //illan pakko-ohjaustunnin tallennus epäonnistui. Asetukset tallennetaan nyt arvojen listana ilman nimiä
  //avaimiin porssisahko ja porssisahko-1... Version 3.x asetukset (porssi, porssi-1...) luetaan kerran eikä niihin kirjoiteta.
  const FULL = 16777215;
  const V3 = { en: 1, mode: 2, m0: { c: 0 }, m1: { l: 0 }, m2: { p: 24, c: 3, l: -999, s: 0, m: 999, ps: 0, pe: 23, ps2: 0, pe2: 23, c2: 0 }, b: FULL, e: 1, o: [0, 1, 2, 3], f: FULL, fc: FULL, i: 0, m: 60, oc: 0 };
  const V3_COMMON = { g: 'fi', vat: 25.5, day: 1, night: 2, names: ['Varaaja', 'Lattia', '-'] };
  const OLD_KEYS = ['porssi', 'porssi-1', 'porssi-2', 'porssi-3'];
  const NEW_KEYS = ['porssisahko', 'porssisahko-1', 'porssisahko-2', 'porssisahko-3'];

  /** Käynnistää skriptin annetulla KVS:n sisällöllä */
  function start(kvs, opts = {}) {
    const sim = createSim(Object.assign({ kvs }, opts));
    sim.settle();
    assertAlive(sim);
    return sim;
  }

  test('simulaattorin raja vastaa laitetta: lainausmerkki ja kenoviiva lasketaan kahtena', () => {
    assert.equal(kvsLength('a'.repeat(253)), 253);
    assert.equal(kvsLength('a'.repeat(200) + '"'.repeat(26)), 252);
    assert.equal(kvsLength('a'.repeat(200) + '"'.repeat(27)), 254);
    assert.equal(kvsLength('a'.repeat(200) + "'".repeat(53)), 253);
    assert.equal(kvsLength('ä'.repeat(127)), 254);
    assert.equal(kvsLength('a\\'), 3);

    //Liian pitkä arvo hylätään kuten laitteella
    const sim = boot();
    sim.evaluate(`Shelly.call("KVS.Set", { key: "x", value: ${JSON.stringify('"'.repeat(127))} }, function (res, err) { _.kvsErr = err; })`);
    sim.evaluate(`Shelly.call("KVS.Set", { key: "y", value: ${JSON.stringify('"'.repeat(126))} }, function (res, err) { _.kvsErr2 = err; })`);
    sim.advance(1000);
    assert.equal(sim.evaluate('_.kvsErr'), -103);
    assert.ok(!sim.kvs.has('x'));
    assert.ok(sim.kvs.has('y'));
  });

  test('merkkien " ja \' vaihto toimii kumpaankin suuntaan', () => {
    const sim = boot();
    const swap = (s) => sim.evaluate(`swapQ(${JSON.stringify(s)})`);
    assert.equal(swap('[1,"fi",["a"]]'), "[1,'fi',['a']]");
    assert.equal(swap("[1,'fi',['a']]"), '[1,"fi",["a"]]');
    for (const s of ['', 'abc', '"', "'", '""\'\'', 'a"b\'c"d', JSON.stringify(['Vaja eli "Liiteri"', "Vaja eli 'Liiteri'", 'Keno\\viiva'])]) {
      assert.equal(swap(swap(s)), s, s);
      assert.equal(swap(s).length, s.length);
      assert.equal(swap(s), kvsSwap(s));
    }
  });

  test('uusi asennus: asetukset tallennetaan listana uusiin avaimiin, vanhoja avaimia ei luoda', () => {
    const sim = start({});
    assert.deepEqual([...sim.kvs.keys()].sort(), ['porssisahko', 'porssisahko-1']);
    assert.equal(sim.kvs.get('porssisahko'), "[1,'fi',25.5,0,0,['-'],1,24,0,1101,331,7,22]");
    assert.equal(sim.kvs.get('porssisahko-1'), '[1,0,0,[0],[0],[24,0,-999,0,999,0,23,0,23,0,0],0,0,[0],0,0,0,60,0,0]');
    //Skriptin oma pakkaus vastaa testien toteutusta
    assert.equal(sim.kvs.get('porssisahko-1'), kvsPack(0, sim.status(0).ci));
    assert.equal(sim.kvs.get('porssisahko'), kvsPack(-1, sim.status(0).c));
  });

  test('päivitys versiosta 3.x: asetukset luetaan vanhoista avaimista, tallennetaan uusiin ja vanhat jäävät koskematta', () => {
    const old = { 'porssi': JSON.stringify(V3_COMMON), 'porssi-1': JSON.stringify(Object.assign({}, V3, { mode: 0, m0: { c: 1 }, o: [0], b: 0, f: 0, fc: 0 })), 'porssi-2': JSON.stringify({ en: 0, o: [0] }), 'porssi-3': JSON.stringify({ en: 0, o: [0] }) };
    const sim = start(old);

    assert.deepEqual([...sim.kvs.keys()].sort(), [...OLD_KEYS, ...NEW_KEYS].sort());
    for (const key of OLD_KEYS) {
      assert.equal(sim.kvs.get(key), old[key], `${key} on ennallaan`);
    }
    assert.ok(NEW_KEYS.every(k => sim.kvs.get(k).startsWith('[1,')));
    assert.deepEqual(sim.cfg(-1), Object.assign({}, V3_COMMON, { cnt: 3, hist: 24, tt: 0, ss: 1101, se: 331, ds: 7, de: 22 }));
    assert.equal(sim.cfg(0).m0.c, 1);
    assert.equal(sim.cfg(0).m2.s2, 0, 'uusi asetus sai arvon');
    assert.equal(sim.cfg(0).q, 0);
    assert.equal(sim.relays[0], true);
    assert.equal(sim.status(0).s.configOK, 1);
  });

  test('ehjät version 3.x asetukset tallennetaan uusiin avaimiin, vaikka mitään ei tarvitse täydentää', () => {
    //Kaikki version 10 kentät on jo annettu - silti asetukset pitää siirtää
    const first = start({});
    const common = JSON.stringify(first.status(0).c);
    const inst = JSON.stringify(first.status(0).ci);
    const sim = start({ 'porssi': common, 'porssi-1': inst });
    assert.ok(sim.kvs.has('porssisahko') && sim.kvs.has('porssisahko-1'));
    assert.deepEqual(sim.cfg(0), JSON.parse(inst));
  });

  test('vanhat avaimet luetaan vain kerran: myöhemmin skripti käyttää omia asetuksiaan', () => {
    const sim = start({ 'porssi': JSON.stringify(V3_COMMON), 'porssi-1': JSON.stringify({ en: 1, mode: 0, m0: { c: 1 }, o: [0] }) });
    assert.equal(sim.relays[0], true);

    //Vanhaa avainta muutetaan (esimerkiksi versio 3.x käynnissä välillä) - versio 10 ei lue sitä enää
    const kvs = Object.fromEntries(sim.kvs);
    kvs['porssi-1'] = JSON.stringify({ en: 1, mode: 0, m0: { c: 0 }, o: [0] });
    const again = start(kvs);
    assert.equal(again.status(0).ci.m0.c, 1);
    assert.equal(again.kvs.get('porssi-1'), kvs['porssi-1']);
    assert.equal(again.kvs.get('porssisahko-1'), kvs['porssisahko-1'], 'ehjiä asetuksia ei kirjoiteta uudelleen');
  });

  test('uudessa muodossa tallennetut asetukset luetaan käynnistyksessä, eikä vanhoja avaimia tarvita', () => {
    const sim = start({ 'porssisahko': "[1,'fi',10,1,2,['Varaaja'],1,48]", 'porssisahko-1': "[1,1,2,[0],['avg'],[-2,2.5,-999,1,'avg',0,6,18,21,1,1],30,1,[0,1],8192,8192,0,45,1,2]" });
    const st = sim.status(0);
    assert.deepEqual(st.c, { g: 'fi', vat: 10, day: 1, night: 2, names: ['Varaaja'], cnt: 1, hist: 48, tt: 0, ss: 1101, se: 331, ds: 7, de: 22 });
    assert.deepEqual(st.ci, { en: 1, mode: 2, m0: { c: 0 }, m1: { l: 'avg' }, m2: { p: -2, c: 2.5, l: -999, s: 1, m: 'avg', ps: 0, pe: 6, ps2: 18, pe2: 21, c2: 1, s2: 1 }, b: 30, e: 1, o: [0, 1], f: 8192, fc: 8192, i: 0, m: 45, oc: 1, q: 2 });
    assert.deepEqual([...sim.kvs.keys()].sort(), ['porssisahko', 'porssisahko-1']);
    assert.equal(sim.kvs.get('porssisahko-1'), "[1,1,2,[0],['avg'],[-2,2.5,-999,1,'avg',0,6,18,21,1,1],30,1,[0,1],8192,8192,0,45,1,2]", 'ehjiä asetuksia ei kirjoiteta uudelleen');
  });

  test('listan lopusta puuttuvat arvot saavat oletusarvon ja täydennetty lista tallennetaan', () => {
    //Näin käy, kun myöhempi versio lisää asetuksen listan loppuun
    const sim = start({ 'porssisahko': "[1,'fi',10,1,2,['A'],1]", 'porssisahko-1': '[1,1,0,[1],[0],[24,0,-999,0,999,0,23,0,23,0],0,0,[0],0,0,0,60,0]' });
    assert.equal(sim.status(0).c.hist, 24);
    assert.equal(sim.status(0).ci.q, 0);
    assert.equal(sim.status(0).ci.m2.s2, 0);
    assert.equal(sim.relays[0], true);
    assert.equal(sim.cfg(-1).hist, 24);
    assert.equal(sim.cfg(0).q, 0);
  });

  test('tuntematon muodon versio tai muu kuin lista: asetus ohitetaan eikä sitä ylikirjoiteta', () => {
    for (const value of ['[2,1,0,[1]]', '[]', '{}', '5', "{'en':1}", '[1,1,0,[1]'] ) {
      const sim = start({ 'porssisahko': "[1,'fi',10,1,2,['A'],1,24]", 'porssisahko-1': value });
      assert.equal(sim.status(0).ci.en, 0, `${value}: ohjaus on oletuksilla`);
      assert.equal(sim.kvs.get('porssisahko-1'), value, `${value}: sisältöä ei ylikirjoiteta`);
      assert.ok(sim.logLines().some(l => l.includes('invalid config porssisahko-1')), value);
    }
  });

  test('nimi, jossa on lainaus- tai heittomerkki, säilyy tallennuksen ja uudelleenkäynnistyksen yli', () => {
    const names = ['Vaja eli "Liiteri"', "Vaja eli 'Liiteri'", 'Keno\\viiva'];
    const first = start({ 'porssi': JSON.stringify({ g: 'fi', vat: 0, day: 0, night: 0, names }), 'porssi-1': JSON.stringify({ en: 1, mode: 0, m0: { c: 0 }, o: [0] }) });
    assert.deepEqual(first.status(0).c.names, names);
    assert.equal(first.kvs.get('porssisahko'), "[1,'fi',0,0,0,['Vaja eli \\'Liiteri\\'','Vaja eli \"Liiteri\"','Keno\\\\viiva'],3,24,0,1101,331,7,22]");

    const sim = start({ 'porssisahko': first.kvs.get('porssisahko'), 'porssisahko-1': first.kvs.get('porssisahko-1') });
    assert.deepEqual(sim.status(0).c.names, names);
  });

  test('päivitys versiosta 3.x täysillä pakko- ja varmuustunneilla ja neljällä lähdöllä onnistuu', () => {
    //Asetusten nimillä JSON-tekstinä täydennetyt asetukset olisivat laitteen laskemana 272 eivätkä tallentuisi
    const sim = start({ 'porssi': JSON.stringify(V3_COMMON), 'porssi-1': JSON.stringify(V3) });
    const saved = sim.kvs.get('porssisahko-1');
    assert.ok(kvsLength(saved) < 110, `pituus ${kvsLength(saved)}`);
    assert.ok(kvsLength(JSON.stringify(sim.cfg(0))) > 253, 'testi mittaa tapausta, joka ei mahdu nimillä');
    assert.equal(sim.cfg(0).f, FULL);
    assert.deepEqual(sim.cfg(0).o, [0, 1, 2, 3]);
    assert.equal(sim.status(0).si.configOK, 1);
    assert.ok(!sim.logLines().some(l => l.includes('failed to set config')), sim.logLines().join(' | '));
  });

  test('pahin tapaus: kaikki kentät suurimmilla arvoilla on noin puolet rajasta', () => {
    const worst = { en: 1, mode: 2, m0: { c: 1 }, m1: { l: -999.99 }, m2: { p: -2, c: 23.75, l: -999.99, s: 1, m: -999.99, ps: 23, pe: 24, ps2: 23, pe2: 24, c2: 23.75, s2: 1 }, b: FULL, e: 1, o: [100, 101, 102, 103], f: FULL, fc: FULL, i: 1, m: 60, oc: 2, q: 2 };
    const sim = boot();
    const value = sim.evaluate(`pack(0, ${JSON.stringify(worst)})`);
    assert.equal(value, kvsPack(0, worst));
    assert.equal(kvsLength(value), 126);
    assert.equal(kvsLength(JSON.stringify(worst)), 303);
    assert.deepEqual(sim.evaluate(`unpack(0, ${JSON.stringify(value)})`), worst);
  });

  test('käsiohjauksen HTTP-pyyntö lukee ja tallentaa uutta muotoa', () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: Object.assign({}, V3, { mode: 0 }) });
    const before = sim.kvs.get('porssi-1');
    assert.equal(sim.get('r=w&i=0&m0.c=1').code, 204);
    sim.advance(5000);
    assertAlive(sim);
    assert.equal(sim.cfg(0).m0.c, 1, 'tallennettu laitteen muistiin');
    assert.equal(sim.relays[0], true);
    assert.equal(sim.kvs.get('porssi-1'), before, 'version 3.x asetuksiin ei kosketa');
    assert.equal(sim.kvs.get('porssisahko-1'), kvsPack(0, sim.status(0).ci));
  });

  test('rikkinäiset version 3.x asetukset päivityksessä: käytetään oletuksia, eikä vanhaa avainta ylikirjoiteta', () => {
    const sim = start({ 'porssi': JSON.stringify(V3_COMMON), 'porssi-1': '{rikki', 'porssi-2': JSON.stringify({ en: 1, mode: 0, m0: { c: 1 }, o: [1] }) });
    assert.ok(sim.logLines().some(l => l.includes('invalid config porssi-1')));
    assert.equal(sim.status(0).ci.en, 0);
    assert.equal(sim.relays[1], true, 'muut ohjaukset toimivat');
    assert.equal(sim.kvs.get('porssi-1'), '{rikki');
  });
});
