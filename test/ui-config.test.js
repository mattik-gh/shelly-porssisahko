/**
 * Asetussivun (src/statics/tab-config.js) tallennuksen testit.
 *
 * Sivun koodi ajetaan kevyessä DOM-korvikkeessa: kentille annetaan arvot,
 * painetaan Tallenna ja tarkistetaan, mitä KVS:ään kirjoitettaisiin.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { uiShared } = require('./sim/ui-shared.js');
const { boot, assertAlive } = require('./helpers');
const { kvsUnpack, kvsLength, kvsPack } = require('./sim/shelly-sim');

const TAB_CONFIG = fs.readFileSync(path.join(__dirname, '..', 'src', 'statics', 'tab-config.js'), 'utf8');

/**
 * Lataa asetussivun annetulla tilalla
 *
 * @param {object} state r=s -vastaus
 * @returns apufunktiot kenttien asettamiseen ja tallennukseen
 */
/** KVS.Set-pyynnön arvo sellaisena kuin laite sen saa */
const kvsValue = (call) => decodeURIComponent(call.substring(call.indexOf('&value="') + 8, call.length - 1));

function configPage(state) {
  const elements = {};
  const listeners = {};
  const calls = [];
  const alerts = [];

  const el = (id) => elements[id] ?? (elements[id] = {
    value: '0', checked: false, innerHTML: '', style: {}, dataset: {},
    addEventListener: (type, fn) => { listeners[`${id}:${type}`] = fn; }
  });

  const clock = { offset: 0 };
  const busy = { count: 0 };

  const context = vm.createContext({
      ...uiShared(),
    state,
    inst: 0,
    CBS: [],
    Date: class extends Date { static now() { return Date.now() + clock.offset; } },
    SRV: '',
    URLS: '',
    MODE_STR: ['a', 'b', 'c'],
    DBG: () => { },
    me: () => '',
    console: { error: () => { }, log: () => { } },
    encodeURIComponent,
    //Ilmoitukset näytetään Tallenna-painikkeen alla (msg() tiedostossa s.js) - tässä ne kerätään listaan
    msg: (text) => alerts.push(text),
    alert: () => { throw new Error('asetussivu ei saa käyttää ilmoitusikkunaa'); },
    qs: el,
    doc: {
      //tuntimäärien ohjetekstit (luokka cnt-h), muut luokat eivät ole testeissä mukana
      querySelectorAll: (sel) => sel === '.cnt-h' ? [el('cnt-h')] : [],
      //pakko-ohjattujen tuntien valinta: ei pakko-ohjausta
      querySelector: () => ({ value: -1 })
    },
    formatDateTime: (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    updateLoop: () => { calls.push('updateLoop'); },
    setTimeout: (fn) => setImmediate(fn),
    clearTimeout: () => { },
    getData: async (url) => {
      calls.push(url);
      //busy = montako seuraavaa pakko-ohjauspyyntöä saa vastauksen 503 (laite ajaa logiikkaa)
      if (url.includes('?r=f') && busy.count > 0) {
        busy.count--;
        return { code: 503, txt: 'Service Unavailable' };
      }
      return { code: /\?r=[rf]/.test(url) ? 204 : 200, txt: 'OK' };
    }
  });

  vm.runInContext(TAB_CONFIG, context, { filename: 'tab-config.js' });

  return {
    el,
    alerts,
    calls,
    /** Kirjoittaa kenttään (ajaa myös syötteen suodatuksen kuten selain) */
    type(id, value) {
      el(id).value = value;
      if (listeners[`${id}:input`]) {
        listeners[`${id}:input`]({ target: el(id) });
      }
    },
    /** Vaihtaa valikon arvon (ajaa myös muutoksen käsittelyn kuten selain) */
    change(id, value) {
      el(id).value = value;
      listeners[`${id}:change`]({ target: el(id) });
    },
    busy,
    /** Painaa painiketta (odottaa mahdollisen pyynnön valmistumisen) */
    async click(id) {
      calls.length = 0;
      await listeners[`${id}:click`]();
    },
    /** Uusi tilavastaus laitteelta (kuten sivun 5 sekunnin välein tekemä haku) */
    async update(newState) {
      context.state = newState;
      await Promise.all(context.CBS.map(cb => cb()));
    },
    /** Siirtää selaimen kelloa eteenpäin */
    wait(ms) {
      clock.offset += ms;
    },
    /** Painaa Tallenna ja palauttaa KVS:ään kirjoitetut ohjauksen asetukset (tai null jos ei tallennettu) */
    async save() {
      calls.length = 0;
      await listeners['save:click']();
      const call = calls.find(c => c.includes('KVS.Set?key="porssisahko-1"'));
      if (!call) {
        return null;
      }
      return kvsUnpack(0, kvsValue(call));
    }
  };
}

/** Asetussivu simulaattorin tilalla */
function page(inst = {}) {
  const sim = boot({ inst: Object.assign({ mode: 0 }, inst) });
  return configPage(sim.status(0));
}

describe('asetussivu: ohjaustavan asetukset', () => {
  const shown = (p) => [0, 1, 2].map(i => p.el('mo' + i).style.display);

  test('näkyvissä on vain valitun ohjaustavan osio', () => {
    assert.deepEqual(shown(page({ mode: 0 })), ['block', 'none', 'none']);
    assert.deepEqual(shown(page({ mode: 1 })), ['none', 'block', 'none']);
    assert.deepEqual(shown(page({ mode: 2 })), ['none', 'none', 'block']);
  });

  test('osio vaihtuu heti, kun ohjaustapaa vaihdetaan', () => {
    const p = page({ mode: 2 });
    p.change('mode', '0');
    assert.deepEqual(shown(p), ['block', 'none', 'none']);
    p.change('mode', '1');
    assert.deepEqual(shown(p), ['none', 'block', 'none']);
  });

  test('piilotettujen osioiden arvot tallentuvat', async () => {
    const p = page({ mode: 2, m0: { c: 1 }, m1: { l: 7.5 }, m2: { p: 6, c: 2 } });
    p.change('mode', '0');
    const saved = await p.save();

    assert.equal(saved.mode, 0);
    assert.equal(saved.m0.c, 1);
    assert.equal(saved.m1.l, 7.5);
    assert.equal(saved.m2.p, 6);
    assert.equal(saved.m2.c, 2);
  });
});

describe('asetussivu: peräkkäiset tunnit jaksoittain', () => {
  test('kummankin jakson valinta näytetään ja tallennetaan erikseen', async () => {
    const p = page({ mode: 2, m2: { p: -2, ps: 0, pe: 12, c: 3, ps2: 12, pe2: 24, c2: 3, s: 1, s2: 0 } });
    assert.ok(p.el('m2-sq').checked);
    assert.ok(!p.el('m2-sq2').checked);

    p.el('m2-sq').checked = false;
    p.el('m2-sq2').checked = true;
    const saved = await p.save();

    assert.equal(saved.m2.s, 0);
    assert.equal(saved.m2.s2, 1);
  });
});

describe('asetussivu: kentät tallennuksen jälkeen', () => {
  const copy = (o) => JSON.parse(JSON.stringify(o));

  /** Sivu, jolla tuntimäärä 2 on muutettu arvosta 1 arvoon 1,5 ja tallennettu. Palauttaa myös laitteen tilan ennen ja jälkeen */
  async function savedPage() {
    const sim = boot({ inst: { mode: 2, q: 2, m2: { p: -2, ps: 0, pe: 24, c: 4, ps2: 0, pe2: 6, c2: 1 } } });
    const before = copy(sim.status(0));
    const p = configPage(sim.status(0));

    p.type('m2-cnt2', '1,5');
    const saved = await p.save();
    assert.equal(saved.m2.c2, 1.5);
    assert.equal(p.el('m2-cnt2').value, 1.5);

    const after = copy(before);
    after.ci = copy(saved);
    return { p, before, after };
  }

  test('laitteen vanha tila heti tallennuksen jälkeen ei palauta vanhoja arvoja kenttiin', async () => {
    const { p, before } = await savedPage();

    //Laite ei ole vielä lukenut uusia asetuksia: tilavastauksessa on vanha arvo
    await p.update(copy(before));
    assert.equal(p.el('m2-cnt2').value, 1.5, 'kentässä on edelleen tallennettu arvo');

    p.wait(5000);
    await p.update(copy(before));
    assert.equal(p.el('m2-cnt2').value, 1.5);
  });

  test('kentät täytetään laitteelta, kun laitteella on tallennetut asetukset', async () => {
    const { p, before, after } = await savedPage();
    await p.update(copy(before));

    //Käyttäjä ehtii muuttaa kenttää, mutta laitteen vahvistus täyttää kentät tallennetuilla arvoilla
    p.el('n').value = 'muutettu';
    p.wait(3000);
    await p.update(copy(after));
    assert.equal(p.el('m2-cnt2').value, 1.5);
    assert.notEqual(p.el('n').value, 'muutettu', 'kentät on täytetty laitteen tilasta');

    //Sen jälkeen kenttiin ei enää kosketa
    p.el('n').value = 'muutettu';
    await p.update(copy(after));
    assert.equal(p.el('n').value, 'muutettu');
  });

  test('avainten järjestys laitteen vastauksessa ei vaikuta vertailuun', async () => {
    const { p, after } = await savedPage();
    const reordered = copy(after);
    reordered.ci = Object.fromEntries(Object.entries(after.ci).reverse());
    reordered.ci.m2 = Object.fromEntries(Object.entries(after.ci.m2).reverse());

    p.el('n').value = 'muutettu';
    await p.update(reordered);
    assert.notEqual(p.el('n').value, 'muutettu', 'laitteen tila tunnistettiin samaksi');
  });

  test('jos laitteella on 15 sekunnin kuluttua yhä vanhat asetukset, kentät täytetään niillä (ei ilmoitusta)', async () => {
    const { p, before } = await savedPage();
    const alertsBefore = p.alerts.length;

    await p.update(copy(before));
    p.wait(16000);
    await p.update(copy(before));

    assert.equal(p.el('m2-cnt2').value, 1, 'kentässä on laitteen (vanha) arvo');
    assert.equal(p.alerts.length, alertsBefore);
  });

  test('jos laite on muuttanut arvoa, kentät täytetään laitteelta 15 sekunnin kuluttua', async () => {
    const { p, after } = await savedPage();
    const changed = copy(after);
    changed.ci.m2.c2 = 2;

    await p.update(copy(changed));
    assert.equal(p.el('m2-cnt2').value, 1.5, 'ensin odotetaan');

    const alertsBefore = p.alerts.length;
    p.wait(16000);
    await p.update(copy(changed));
    assert.equal(p.el('m2-cnt2').value, 2, 'sitten näytetään laitteen arvo');
    assert.equal(p.alerts.length, alertsBefore);
  });
});

describe('asetussivu: numerokenttien pituusrajat', () => {
  const typed = (p, id, value) => { p.type(id, value); return p.el(id).value; };

  test('hintarajat: enintään 3 numeroa ja 2 desimaalia, miinus ja avg sallittu', () => {
    const p = page({ mode: 2 });

    for (const id of ['m1-lim', 'm2-lim', 'm2-m']) {
      assert.equal(typed(p, id, '12.345678'), '12.34');
      assert.equal(typed(p, id, '-999.999'), '-999.99');
      assert.equal(typed(p, id, '12345'), '123');
      assert.equal(typed(p, id, '1234,5'), '123,5');
      assert.equal(typed(p, id, '-0,5'), '-0,5');
      assert.equal(typed(p, id, 'avg'), 'avg');
    }
  });

  test('siirtomaksut: enintään 999.99, ALV: enintään 99.99', () => {
    const p = page({ mode: 2 });

    assert.equal(typed(p, 'day', '1234.567'), '123.56');
    assert.equal(typed(p, 'night', '12,456'), '12,45');
    assert.equal(typed(p, 'vat', '26,255'), '26,25');
    assert.equal(typed(p, 'vat', '255'), '25');
    assert.equal(typed(p, 'day', '-5'), '5', 'negatiivinen ei ole sallittu');
  });

  test('tuntimäärät, minuutit ja jaksojen tunnit: enintään 2 numeroa', () => {
    const p = page({ mode: 2, q: 1 });

    assert.equal(typed(p, 'm2-cnt', '10,256'), '10,25');
    assert.equal(typed(p, 'm2-cnt2', '123.5'), '12.5');
    assert.equal(typed(p, 'min', '600'), '60');
    assert.equal(typed(p, 'm2-ps', '123'), '12');
    assert.equal(typed(p, 'm2-pe2', '2.4'), '24', 'desimaalit eivät ole sallittuja');
  });

  test('nimikentän enimmäispituus on 30 merkkiä', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'statics', 'tab-config.html'), 'utf8');
    assert.match(html, /<input type="text" id="n" maxlength="30">/);
  });
});

describe('asetussivu: asetusten enimmäispituus (Shellyn raja 253 tavua per arvo)', () => {
  /** Täyttää kentät suurimmilla arvoilla, jotka kentät sallivat */
  function fillMax(p, outs) {
    p.el('en').checked = true;
    p.change('mode', '2');
    p.el('q').value = '1';
    p.type('m1-lim', '-999.99');
    p.type('m2-lim', '-999.99');
    p.type('m2-m', '-999.99');
    p.el('m2-per').value = '-2';
    p.type('m2-ps', '0');
    p.type('m2-pe', '24');
    p.type('m2-ps2', '0');
    p.type('m2-pe2', '24');
    p.type('m2-cnt', '23.75');
    p.type('m2-cnt2', '23.75');
    p.el('m2-sq').checked = true;
    p.el('m2-sq2').checked = true;
    p.el('m0-cmd').checked = true;
    p.el('inv').checked = true;
    p.el('err').checked = true;
    p.el('oc').value = '1';
    p.type('min', '60');
    p.type('outs', outs);
    for (let i = 0; i < 24; i++) {
      p.el(`b${i}`).checked = true;
    }
  }

  test('pahin tapaus mahtuu: kaikki kentät suurimmilla arvoilla ja neljä kolminumeroista lähtöä', async () => {
    const p = page({ mode: 2 });
    fillMax(p, '100,101,102,103');
    p.type('vat', '99.99');
    p.type('day', '999.99');
    p.type('night', '999.99');
    p.el('n').value = 'ä'.repeat(30);

    const saved = await p.save();
    assert.ok(saved, 'asetukset tallennettiin');

    const calls = p.calls.filter(c => c.includes('KVS.Set'));
    //Pituus lasketaan kuten laite laskee sen: tavut, ja merkit " ja \ kahtena
    const lengths = calls.map(c => kvsLength(kvsValue(c)));
    assert.equal(lengths.length, 2);
    assert.ok(lengths.every(l => l <= 253), `pituudet ${lengths.join(' ja ')} tavua`);
    //Testisivulla ei voi valita pakko-ohjattuja tunteja. Kaikki 24 tuntia valittuna kentät f ja fc
    //ovat kumpikin 16777215 (8 merkkiä) arvon 0 sijaan, eli 14 merkkiä lisää
    assert.equal(saved.f, 0);
    assert.equal(saved.b, 16777215);
    assert.ok(lengths[0] + 14 <= 253, `ohjauksen asetukset pakko-ohjaustunteineen ${lengths[0] + 14} tavua`);
    //Listamuodossa pahin tapaus on noin puolet rajasta (asetusten nimillä JSON-tekstinä se oli laitteen laskemana 303)
    assert.ok(lengths[0] >= 100 && lengths[0] <= 130, `ohjauksen asetukset ${lengths[0]} tavua - testi mittaa pahinta tapausta`);
  });

  test('asetukset tallennetaan listana uusiin avaimiin, ja skripti lukee ne samoiksi asetuksiksi', async () => {
    //Asetussivu tallentaa arvot avainten järjestyksessä - skriptin pitää lukea ne samaan järjestykseen
    const sim = boot({ inst: { mode: 2, q: 2, m2: { p: -2, c: 4, ps: 0, pe: 24, ps2: 0, pe2: 6, c2: 1 } }, common: { vat: 25.5, day: 7.45, night: 5.68, names: ['Varaaja', '-', '-'] } });
    const p = configPage(sim.status(0));
    fillMax(p, '0,1');
    p.type('vat', '24');
    p.type('day', '7.45');
    p.type('night', '5.68');
    p.el('n').value = 'Vaja eli "Liiteri"';
    const saved = await p.save();
    assert.ok(saved);

    const calls = p.calls.filter(c => c.includes('KVS.Set'));
    assert.match(calls[0], /KVS\.Set\?key="porssisahko-1"&value="/);
    assert.match(calls[1], /KVS\.Set\?key="porssisahko"&value="/);
    const values = calls.map(kvsValue);
    assert.ok(values.every(v => v.startsWith('[1,') && !v.includes('{')), values.join(' | '));
    assert.equal(values[1], "[1,'fi',24,7.45,5.68,['Vaja eli \\'Liiteri\\'','-','-'],3,24,0,1101,331,7,22]");

    //Kirjoitetaan arvot laitteelle kuten selain tekee ja pyydetään skriptiä lataamaan ne
    sim.kvs.set('porssisahko-1', values[0]);
    sim.kvs.set('porssisahko', values[1]);
    sim.get('r=r&i=0');
    sim.settle();
    assertAlive(sim);

    const st = sim.status(0);
    assert.deepEqual(st.ci, saved);
    assert.deepEqual(st.ci, { en: 1, mode: 2, m0: { c: 1 }, m1: { l: -999.99 }, m2: { p: -2, c: 23.75, l: -999.99, s: 1, m: -999.99, ps: 0, pe: 24, ps2: 0, pe2: 24, c2: 23.75, s2: 1 }, b: 16777215, e: 1, o: [0, 1], f: 0, fc: 0, i: 1, m: 60, oc: 1, q: 1 });
    assert.equal(st.c.vat, 24);
    assert.deepEqual(st.c.names, ['Vaja eli "Liiteri"', '-', '-']);
    //Skripti ei kirjoita ehjiä asetuksia uudelleen, ja sen oma muoto on sama kuin asetussivun
    assert.equal(sim.kvs.get('porssisahko-1'), values[0]);
    assert.equal(kvsPack(0, st.ci), values[0]);
    assert.equal(kvsPack(-1, st.c), values[1]);
  });

  test('skriptin lähettämien asetusten avaimet ovat aina tallennusjärjestyksessä', () => {
    const INST = ['en', 'mode', 'm0', 'm1', 'm2', 'b', 'e', 'o', 'f', 'fc', 'i', 'm', 'oc', 'q'];
    const M2 = ['p', 'c', 'l', 's', 'm', 'ps', 'pe', 'ps2', 'pe2', 'c2', 's2'];
    const COMMON = ['g', 'vat', 'day', 'night', 'names', 'cnt', 'hist', 'tt', 'ss', 'se', 'ds', 'de'];
    const check = (sim, what) => {
      const st = sim.status(0);
      assert.deepEqual(Object.keys(st.ci), INST, what);
      assert.deepEqual(Object.keys(st.ci.m2), M2, what);
      assert.deepEqual(Object.keys(st.c), COMMON, what);
    };

    //Uusi asennus (oletusasetukset)
    const fresh = require('./sim/shelly-sim').createSim();
    fresh.settle();
    check(fresh, 'uusi asennus');

    //Version 3.x asetukset eri järjestyksessä ja vajaina
    const old = require('./sim/shelly-sim').createSim({ kvs: { 'porssi': { names: ['A', '-', '-'], night: 1, g: 'fi', day: 2, vat: 10 }, 'porssi-1': { o: [0], m2: { c: 2, p: 12 }, mode: 2, en: 1 } } });
    old.settle();
    check(old, 'päivitys versiosta 3.x');
    assert.equal(old.status(0).ci.m2.p, 12);
    assert.equal(old.status(0).c.day, 2);

    //Uudelleenlataus ja määrän muutos
    old.saveConfig(0, { q: 1 }, { cnt: 2 });
    check(old, 'tallennuksen jälkeen');
  });

  test('tavalliset asetukset ja illan pakko-ohjaustunti mahtuvat (korjattu: laite laskee merkin " kahtena)', async () => {
    //Laitteella: nämä asetukset ja pakko-ohjaus tunnille 23 antoivat virheen "length should be less than 255",
    //koska asetusten nimillä JSON-tekstinä 203 merkkiä on laitteen laskemana 257
    const inst = { en: 1, mode: 2, m0: { c: 0 }, m1: { l: 0 }, m2: { p: -2, c: 4, l: -999, s: 0, m: 999, ps: 0, pe: 24, ps2: 0, pe2: 6, c2: 1, s2: 0 }, b: 30, e: 1, o: [0], f: 8388608, fc: 8388608, i: 0, m: 60, oc: 0, q: 2 };
    assert.equal(kvsLength(JSON.stringify(inst)), 257);
    assert.equal(kvsLength(kvsPack(0, inst)), 80);
  });

  test('merkit " ja \\ lasketaan pituuteen kahtena: liian pitkä nimi hylätään ennen kirjoitusta', async () => {
    //Nimessä 80 lainausmerkkiä: tallennettuna jokainen on \' eli laitteen laskemana 3 (yhteensä 240 + muut asetukset)
    const p = page({ mode: 0 });
    p.el('outs').value = '0';
    p.el('n').value = '"'.repeat(80);
    assert.equal(await p.save(), null);
    assert.match(p.alerts[p.alerts.length - 1], /Asetukset eivät mahdu laitteen muistiin/);

    //Sama määrä tavallisia merkkejä mahtuu
    const q = page({ mode: 0 });
    q.el('outs').value = '0';
    q.el('n').value = 'a'.repeat(80);
    assert.ok(await q.save());
  });

  test('liian pitkiä asetuksia ei kirjoiteta lainkaan, ja syy kerrotaan', async () => {
    const p = page({ mode: 2 });
    fillMax(p, '1000,1001,1002,1003,1004,1005');
    //Lähtöjä saa olla enintään neljä - pitkä lista hylätään jo aiemmin, joten ylitys tehdään nimillä
    p.type('outs', '100,101,102,103');
    p.el('n').value = 'ä'.repeat(120);

    const saved = await p.save();
    assert.equal(saved, null, 'mitään ei kirjoitettu');
    assert.equal(p.calls.filter(c => c.includes('KVS.Set')).length, 0);
    assert.match(p.alerts[p.alerts.length - 1], /Asetukset eivät mahdu laitteen muistiin/);
  });
});

describe('asetussivu: pakko-ohjaus', () => {
  const copy = (o) => JSON.parse(JSON.stringify(o));
  const forceCall = (p) => p.calls.find(c => c.includes('?r=f'));

  test('lähdön tila näytetään, ja perumispainike on piilossa, kun pakko-ohjausta ei ole', () => {
    const on = page({ mode: 0, m0: { c: 1 } });
    assert.equal(on.el('fo-s').innerHTML, '<b style="color:green">PÄÄLLÄ</b> – ei pakko-ohjausta');
    assert.equal(on.el('fo-c').style.display, 'none');

    const off = page({ mode: 0, m0: { c: 0 } });
    assert.equal(off.el('fo-s').innerHTML, '<b style="color:red">POIS</b> – ei pakko-ohjausta');
  });

  test('ohjaus ei käytössä: tilarivi kertoo sen', () => {
    assert.equal(page({ en: 0 }).el('fo-s').innerHTML, 'Ei käytössä');
  });

  test('päälle ja pois: kesto lähetetään minuutteina ja suunta oikein', async () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 0 } } });
    const state = sim.status(0);
    const p = configPage(state);

    p.type('fo-h', '2,5');
    await p.click('fo-1');
    assert.equal(forceCall(p), '?r=f&i=0&mi=150&c=1');
    assert.ok(p.calls.includes('updateLoop'), 'tila haetaan heti uudelleen');
    assert.equal(p.alerts.length, 0, 'onnistumisesta ei tule erillistä ilmoitusta');

    await p.click('fo-0');
    assert.equal(forceCall(p), '?r=f&i=0&mi=150&c=0');
  });

  describe('odotusmerkki painalluksen jälkeen', () => {
    const SPIN = '<span class="spn"></span>';
    const disabled = (p) => ['fo-1', 'fo-0', 'fo-c'].map(id => !!p.el(id).disabled);

    async function clicked() {
      const sim = boot({ inst: { mode: 0, m0: { c: 0 } } });
      const before = sim.status(0);
      const p = configPage(copy(before));
      p.type('fo-h', '2');
      await p.click('fo-1');
      const after = copy(before);
      after.si.fCmdTs = before.t + 7200;
      after.si.fCmd = 1;
      return { p, before, after };
    }

    test('painalluksen jälkeen näkyy odotusmerkki ja painikkeet ovat pois käytöstä', async () => {
      const { p } = await clicked();
      assert.equal(p.el('fo-s').innerHTML, SPIN);
      assert.deepEqual(disabled(p), [true, true, true]);
    });

    test('laitteen vanha tila ei poista odotusmerkkiä, ja tilaa haetaan uudelleen', async () => {
      const { p, before } = await clicked();
      p.calls.length = 0;
      await p.update(copy(before));
      assert.equal(p.el('fo-s').innerHTML, SPIN);
      await new Promise(resolve => setImmediate(resolve));
      assert.ok(p.calls.includes('updateLoop'), 'uusi haku on ajastettu');
    });

    test('kun laitteella on uusi pakko-ohjaus, tila näytetään ja painikkeet palaavat käyttöön', async () => {
      const { p, after } = await clicked();
      await p.update(copy(after));
      assert.match(p.el('fo-s').innerHTML, /^<b style="color:green">PÄÄLLÄ<\/b> – pakko-ohjaus .* asti$/);
      assert.deepEqual(disabled(p), [false, false, false]);
    });

    test('jos muutosta ei näy 10 sekunnissa, näytetään laitteen tila', async () => {
      const { p, before } = await clicked();
      p.wait(11000);
      await p.update(copy(before));
      assert.equal(p.el('fo-s').innerHTML, '<b style="color:red">POIS</b> – ei pakko-ohjausta');
      assert.deepEqual(disabled(p), [false, false, false]);
    });

    test('virheen jälkeen odotusmerkkiä ei näytetä', async () => {
      const sim = boot({ inst: { mode: 0, m0: { c: 0 } } });
      const before = sim.status(0);
      const p = configPage(copy(before));
      p.type('fo-h', '1');
      p.busy.count = 99;
      await p.click('fo-1');
      await p.update(copy(before));
      assert.equal(p.el('fo-s').innerHTML, '<b style="color:red">POIS</b> – ei pakko-ohjausta');
      assert.match(p.alerts[p.alerts.length - 1], /^Virhe: /);
    });

    test('ilman kestoa painallus ei käynnistä odotusta', async () => {
      const p = page({ mode: 0, m0: { c: 0 } });
      p.el('fo-h').focus = () => { };
      p.type('fo-h', '');
      await p.click('fo-1');
      assert.notEqual(p.el('fo-s').innerHTML, SPIN);
    });
  });

  test('laite varattu (503): pyyntö yritetään uudelleen eikä virhettä näytetä', async () => {
    const p = page({ mode: 0, m0: { c: 0 } });
    p.type('fo-h', '1');
    p.busy.count = 3;
    await p.click('fo-1');

    assert.equal(p.calls.filter(c => c.includes('?r=f')).length, 4, 'kolme hylättyä ja yksi onnistunut');
    assert.equal(p.alerts.length, 0);
  });

  test('laite pysyy varattuna: virhe näytetään', async () => {
    const p = page({ mode: 0, m0: { c: 0 } });
    p.type('fo-h', '1');
    p.busy.count = 99;
    await p.click('fo-1');

    assert.equal(p.calls.filter(c => c.includes('?r=f')).length, 8);
    assert.match(p.alerts[p.alerts.length - 1], /^Virhe: /);
  });

  test('ilman kestoa mitään ei lähetetä', async () => {
    const p = page({ mode: 0, m0: { c: 0 } });
    let focused = false;
    p.el('fo-h').focus = () => { focused = true; };

    for (const value of ['', '0']) {
      p.type('fo-h', value);
      await p.click('fo-1');
      assert.equal(forceCall(p), undefined);
    }
    assert.ok(focused, 'kohdistus siirtyy kestokenttään');
  });

  test('keston kenttään voi kirjoittaa vain luvun (enintään 2 numeroa ja 2 desimaalia)', () => {
    const p = page({ mode: 0 });
    p.type('fo-h', 'abc123.456');
    assert.equal(p.el('fo-h').value, '12.45');
  });

  test('voimassa oleva pakko-ohjaus näytetään päättymisaikoineen ja sen voi perua', async () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 0 } } });
    sim.get(`r=f&i=0&ts=${sim.epoch() + 2 * 3600}&c=1`);
    sim.settle();
    const state = sim.status(0);
    assert.equal(state.si.cmd, 1, 'laite on pakko-ohjannut lähdön päälle');

    const p = configPage(state);
    assert.match(p.el('fo-s').innerHTML, /^<b style="color:green">PÄÄLLÄ<\/b> – pakko-ohjaus \d\d:\d\d asti$/);
    assert.equal(p.el('fo-c').style.display, '');

    await p.click('fo-c');
    assert.equal(forceCall(p), '?r=f&i=0&mi=0&c=0');
  });

  test('voimassa olevan pakko-ohjauksen aikana vastakkainen painike on piilossa', () => {
    const shown = (p) => ['fo-1', 'fo-0', 'fo-c'].map(id => p.el(id).style.display != 'none');
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 0 } } });
    const withForce = (fCmd, i = 0) => {
      const st = copy(sim.status(0));
      st.si.fCmdTs = fCmd === null ? 0 : st.t + 3600;
      st.si.fCmd = fCmd || 0;
      st.ci.i = i;
      return configPage(st);
    };

    //Painikkeet: Päällä, Pois, Peru
    assert.deepEqual(shown(withForce(null)), [true, true, false], 'ei pakko-ohjausta: molemmat suunnat');
    assert.deepEqual(shown(withForce(1)), [true, false, true], 'pakko-ohjaus päällä: vain Päällä (jatko) ja Peru');
    assert.deepEqual(shown(withForce(0)), [false, true, true], 'pakko-ohjaus pois: vain Pois (jatko) ja Peru');
    //Käänteinen ohjaus: painikkeet seuraavat lähdön tilaa, ei ohjauskomentoa
    assert.deepEqual(shown(withForce(1, 1)), [false, true, true], 'käänteinen: komento päälle = lähtö pois');
    assert.deepEqual(shown(withForce(0, 1)), [true, false, true], 'käänteinen: komento pois = lähtö päällä');
  });

  test('pakko-ohjauksen jatko: sama suunta uudella kestolla painallushetkestä', async () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 0 } } });
    sim.get(`r=f&i=0&ts=${sim.epoch() + 1200}&c=1`);
    sim.settle();
    const state = sim.status(0);
    const p = configPage(state);

    p.type('fo-h', '2');
    await p.click('fo-1');
    assert.equal(forceCall(p), '?r=f&i=0&mi=120&c=1');
  });

  test('päättynyt pakko-ohjaus ei näy voimassa olevana', async () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 0 } } });
    const state = copy(sim.status(0));
    state.si.fCmdTs = state.t - 60;
    state.si.fCmd = 1;

    const p = configPage(state);
    assert.equal(p.el('fo-s').innerHTML, '<b style="color:red">POIS</b> – ei pakko-ohjausta');
    assert.equal(p.el('fo-c').style.display, 'none');
  });

  test('käänteinen ohjaus: "päällä" tarkoittaa lähtöä, joten laitteelle lähetetään ohjaus pois', async () => {
    const sim = boot({ start: '2026-10-05T10:00:00', inst: { mode: 0, m0: { c: 0 }, i: 1 } });
    const state = sim.status(0);
    const p = configPage(state);
    assert.match(p.el('fo-s').innerHTML, />PÄÄLLÄ</, 'käänteisenä ohjaus pois = lähtö päällä');

    p.type('fo-h', '1');
    await p.click('fo-1');
    assert.equal(forceCall(p), '?r=f&i=0&mi=60&c=0');
    await p.click('fo-0');
    assert.equal(forceCall(p), '?r=f&i=0&mi=60&c=1');

    //Laite: pakko-ohjaus "ohjaus pois" käänteisenä pitää lähdön päällä, ja sivu näyttää sen lähtönä
    sim.get(`r=f&i=0&ts=${sim.epoch() + 3600}&c=0`);
    sim.settle();
    assert.equal(sim.relays[0], true);
    assert.match(configPage(sim.status(0)).el('fo-s').innerHTML, />PÄÄLLÄ<\/b> – pakko-ohjaus /);
  });
});

describe('asetussivu: ohjattavat lähdöt', () => {
  test('kenttään ladataan nykyiset lähdöt', () => {
    assert.equal(page({ o: [0, 2] }).el('outs').value, '0,2');
    assert.equal(page({ o: [] }).el('outs').value, '');
  });

  const valid = {
    '0': [0],
    '1': [1],
    '0,1': [0, 1],
    '0,1,100': [0, 1, 100],
    '1,2,': [1, 2],
    ',1,2': [1, 2],
    ',,3,,': [3],
    ' 0 , 1 ': [0, 1],
    '2,2,1': [2, 1],
    '': [0],
    ',': [0],
    '   ': [0]
  };

  for (const input in valid) {
    test(`"${input}" tallentuu muodossa ${JSON.stringify(valid[input])}`, async () => {
      const p = page();
      p.el('outs').value = input;
      const saved = await p.save();

      assert.deepEqual(saved.o, valid[input]);
      assert.equal(p.el('outs').value, valid[input].join(','), 'kenttä näyttää tallennetun arvon');
      assert.deepEqual(p.alerts, ['Tallennettu']);
    });
  }

  for (const input of ['a', '0;1', '0 1', '1,,2', '1.5', '-1', '0,1,2,3,4']) {
    test(`"${input}" hylätään eikä mitään tallenneta`, async () => {
      const p = page();
      p.el('outs').value = input;
      const saved = await p.save();

      assert.equal(saved, null);
      assert.equal(p.calls.length, 0);
      assert.equal(p.alerts.length, 1);
      assert.match(p.alerts[0], /^Virhe: Ohjattavat lähdöt/);
    });
  }

  test('kirjoittaessa hyväksytään vain numerot ja pilkut', () => {
    const p = page();
    p.type('outs', '0; 1a,2 x');
    assert.equal(p.el('outs').value, '01,2');
    p.type('outs', '0,1');
    assert.equal(p.el('outs').value, '0,1');
  });

  test('varoitus näkyy, kun lähtöä ei ole määritetty', async () => {
    const p = page({ o: [] });
    assert.equal(p.el('outs').value, '');
    assert.match(p.el('outs-h').innerHTML, /Lähtöä ei ole määritetty/);
    assert.match(p.el('outs').style.border, /red/);

    //Varoitus poistuu kirjoitettaessa ja palaa, jos kenttä tyhjennetään tallentamatta
    p.type('outs', '1');
    assert.equal(p.el('outs-h').innerHTML, '', 'kentän vieressä ei ole tekstiä (ohje on rivin nimen takana)');
    assert.equal(p.el('outs').style.border, '');
    p.type('outs', '');
    assert.match(p.el('outs-h').innerHTML, /Lähtöä ei ole määritetty/);

    //Tallennuksen jälkeen lähtö on määritetty
    await p.save();
    assert.equal(p.el('outs').value, '0');
    assert.equal(p.el('outs-h').innerHTML, '', 'kentän vieressä ei ole tekstiä (ohje on rivin nimen takana)');
    assert.equal(p.el('outs').style.border, '');
  });

  test('varoitusta ei näy, kun lähtö on määritetty', () => {
    const p = page({ o: [0] });
    assert.equal(p.el('outs-h').innerHTML, '', 'kentän vieressä ei ole tekstiä (ohje on rivin nimen takana)');
    assert.equal(p.el('outs').style.border, '');

    //Kentän tyhjentäminen ei tuo varoitusta, koska tallennettu asetus on kunnossa
    p.type('outs', '');
    assert.equal(p.el('outs-h').innerHTML, '', 'kentän vieressä ei ole tekstiä (ohje on rivin nimen takana)');
  });

  test('tyhjä lähtölista muuttuu tallennettaessa oletukseksi 0', async () => {
    const p = page({ o: [] });
    assert.equal(p.el('outs').value, '');
    assert.deepEqual((await p.save()).o, [0]);
  });

  test('muut asetukset tallentuvat ennallaan', async () => {
    const p = page({ mode: 2, o: [1], m2: { p: 12, c: 3 } });
    //Kentät, joiden oletusarvo korvikkeessa ei vastaa ladattua asetusta, asetetaan sivun latauksessa
    const saved = await p.save();

    assert.equal(saved.mode, 2);
    assert.deepEqual(saved.o, [1]);
    assert.equal(saved.m2.p, 12);
    assert.equal(saved.m2.c, 3);
  });
});

describe('asetussivu: ohjausten määrä', () => {
  test('kenttään ladataan nykyinen määrä ja se tallennetaan yleisiin asetuksiin', async () => {
    const sim = boot({ common: { cnt: 2 } });
    const p = configPage(sim.status(0));
    assert.equal(p.el('cnt').value, 2);

    p.el('cnt').value = '1';
    await p.save();
    const call = p.calls.find(c => c.includes('KVS.Set?key="porssisahko"&'));
    const common = kvsUnpack(-1, kvsValue(call));
    assert.equal(common.cnt, 1);
  });
});

describe('asetussivu: historian pituus', () => {
  test('kenttään ladataan nykyinen pituus ja se tallennetaan yleisiin asetuksiin', async () => {
    const sim = boot({ common: { hist: 48 } });
    const p = configPage(sim.status(0));
    assert.equal(p.el('hist').value, 48);

    p.el('hist').value = '96';
    await p.save();
    const call = p.calls.find(c => c.includes('KVS.Set?key="porssisahko"&'));
    const common = kvsUnpack(-1, kvsValue(call));
    assert.equal(common.hist, 96);
  });
});

describe('historiasivu', () => {
  const TAB_HISTORY = fs.readFileSync(path.join(__dirname, '..', 'src', 'statics', 'tab-history.js'), 'utf8');

  test('pakatut rivit näytetään uusin ensin päivämäärän ja kellonajan kanssa', async () => {
    const price = (e, d) => d.getHours() % 2;
    const sim = boot({ start: '2026-10-05T22:10:00', inst: { mode: 1, m1: { l: 0 } }, price });
    sim.advanceTo('2026-10-06T01:10:00');

    const elements = {};
    const pad = (n) => String(n).padStart(2, '0');
    const context = vm.createContext({
      ...uiShared(),
      state: sim.status(0),
      inst: 0,
      activeTab: 'tab-history',
      CBS: [],
      URLS: '',
      console,
      qs: (id) => elements[id] ?? (elements[id] = { innerHTML: '' }),
      STATE_STR: ['', 'Käsiohjaus', 'Hinta alle rajan', 'Hinta yli rajan'],
      formatDateTime: (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
      atob: (str) => Buffer.from(str, 'base64').toString('latin1'),
      getData: async () => ({ ok: true, code: 200, data: sim.historyRaw(0) })
    });
    vm.runInContext(TAB_HISTORY, context, { filename: 'tab-history.js' });
    await new Promise(r => setTimeout(r, 10));

    const rows = elements['s-hist'].innerHTML.split('<tr>').slice(1).map(r => r.replace(/<[^>]+>/g, '|').split('|').filter(x => x));
    assert.deepEqual(rows, [
      ['06.10.2026 01:00', 'Ohjaus pois', 'Hinta yli rajan'],
      ['06.10.2026 00:00', 'Ohjaus päälle', 'Hinta alle rajan'],
      ['05.10.2026 23:00', 'Ohjaus pois', 'Hinta yli rajan'],
      ['05.10.2026 22:10', 'Ohjaus päälle', 'Hinta alle rajan']
    ]);
  });
});

describe('asetussivu: hinnan tarkkuus', () => {
  test('oletus on tunnin keskiarvo ja ohjausminuutit näkyvät', () => {
    const p = page();
    assert.equal(p.el('q').value, 0);
    assert.equal(p.el('cfg').dataset.r, 1, 'ohjausminuutit ja tunnin ohjetekstit näkyvät (tyylisäännöt tab-config.html)');
  });

  test('varttiohjaus tallentuu ja piilottaa ohjausminuutit', async () => {
    const p = page();
    p.el('q').value = '1';
    const saved = await p.save();
    assert.equal(saved.q, 1);

    const p2 = page({ q: 1 });
    assert.equal(p2.el('q').value, 1);
    assert.equal(p2.el('cfg').dataset.r, 4, 'ohjausminuutit piilossa, vartin ohjetekstit');
  });
});

describe('asetussivu: 30 minuutin tarkkuus ja tuntimäärän syöttö', () => {
  test('30 min tarkkuus tallentuu ja piilottaa ohjausminuutit', async () => {
    const p = page();
    p.el('q').value = '2';
    assert.equal((await p.save()).q, 2);

    const p2 = page({ q: 2 });
    assert.equal(p2.el('q').value, 2);
    assert.equal(p2.el('cfg').dataset.r, 2, 'ohjausminuutit piilossa, 30 minuutin ohjetekstit');
  });

  test('ohjeteksti kertoo mitä tuntimääräksi voi syöttää', () => {
    //Tekstit ovat sivulla, ja tarkkuuden mukainen näytetään tyylisäännöllä (data-r)
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'statics', 'tab-config.html'), 'utf8');
    for (const [r, text] of [[1, 'Kokonaiset tunnit.'], [2, '0.5 h välein (esim. 1.5).'], [4, '0.25 h välein (esim. 1.25).']]) {
      assert.equal(html.split(`<i class="r${r}">${text}</i>`).length - 1, 2, `${text} molemmilla tuntimäärillä`);
      assert.ok(html.includes(`#cfg[data-r="${r}"] .r${r}`), `tyylisääntö r${r}`);
    }
    assert.ok(html.includes('#cfg:not([data-r="1"]) #min-r'), 'ohjausminuutit vain tuntitarkkuudella');
    assert.equal(page().el('cfg').dataset.r, 1);
    assert.equal(page({ q: 2 }).el('cfg').dataset.r, 2);
    assert.equal(page({ q: 1 }).el('cfg').dataset.r, 4);
  });

  const masks = [
    //[tarkkuus, syöte, kenttään jää]
    [0, '3', '3'], [0, '1,5', '15'], [0, '2.5', '25'], [0, 'a4 h', '4'], [0, '-2', '2'],
    [2, '1,5', '1,5'], [2, '1.5', '1.5'], [2, '1,5,2', '1,52'], [2, '1.5,2', '1.52'], [2, 'x2,5h', '2,5'], [2, '12', '12'],
    [1, '0,75', '0,75'], [1, '1.25', '1.25'], [1, ',5', ',5'], [1, '-1.5', '1.5']
  ];

  for (const [q, input, expected] of masks) {
    test(`maski: tarkkuus ${q}, "${input}" -> "${expected}"`, () => {
      const p = page({ mode: 2, q });
      p.type('m2-cnt', input);
      assert.equal(p.el('m2-cnt').value, expected);
      p.type('m2-cnt2', input);
      assert.equal(p.el('m2-cnt2').value, expected);
    });
  }

  const rounding = [
    //[tarkkuus, syöte, tallentuu]
    [0, '3', 3], [0, '1,5', 2], [0, '1.4', 1],
    [2, '1,5', 1.5], [2, '1,25', 1.5], [2, '1,2', 1], [2, '0,5', 0.5], [2, ',5', 0.5],
    [1, '0,75', 0.75], [1, '1,25', 1.25], [1, '1,1', 1], [1, '1,4', 1.5], [1, '2', 2], [1, '', 0]
  ];

  for (const [q, input, expected] of rounding) {
    test(`tallennus: tarkkuus ${q}, "${input}" -> ${expected} h`, async () => {
      const p = page({ mode: 2, q, m2: { p: 24 } });
      p.el('q').value = String(q);
      p.el('m2-per').value = '24';
      p.el('m2-cnt').value = input;
      const saved = await p.save();

      assert.equal(saved.m2.c, expected);
      assert.equal(String(p.el('m2-cnt').value), String(expected), 'kentässä näkyy tallennettu arvo');
    });
  }

  test('tarkkuuden vaihto tunniksi pyöristää tuntimäärän tallennuksessa', async () => {
    const p = page({ mode: 2, q: 1, m2: { p: 24, c: 1.25 } });
    assert.equal(p.el('m2-cnt').value, 1.25);
    p.el('m2-per').value = '24';
    p.el('q').value = '0';
    assert.equal((await p.save()).m2.c, 1);
  });

  test('tuntimäärä rajataan jakson pituuteen', async () => {
    const p = page({ mode: 2, q: 2 });
    p.el('m2-per').value = '4';
    p.el('m2-cnt').value = '5,5';
    assert.equal((await p.save()).m2.c, 4);
  });
});

describe('asetussivu: numerokenttien maskit', () => {
  const cases = {
    //ALV ja siirtomaksut: desimaaliluku
    'vat': [['25.5', '25.5'], ['25,5', '25,5'], ['-5', '5'], ['abc', ''], ['1.2.3', '1.23'], ['avg', '']],
    'day': [['4.03', '4.03'], ['4,03 c', '4,03']],
    'night': [['1,5', '1,5'], ['x', '']],
    //Hintarajat: desimaaliluku (myös negatiivinen) tai avg
    'm1-lim': [['5.5', '5.5'], ['-2,5', '-2,5'], ['avg', 'avg'], ['AVG', 'avg'], ['av', 'av'], ['a', 'a'], ['avgx', ''], ['ab', ''], ['1-2', '12'], ['--3', '-3'], ['5e3', '53']],
    'm2-lim': [['avg', 'avg'], ['-999', '-999'], ['0.', '0.']],
    'm2-m': [['avg', 'avg'], ['12,34', '12,34'], ['max', '']],
    //Kokonaisluvut
    'min': [['45', '45'], ['4.5', '45'], ['-5', '5'], ['x', '']],
    'm2-ps': [['07', '07'], ['7,5', '75'], ['a', '']],
    'm2-pe': [['24', '24']],
    'm2-ps2': [['1.', '1']],
    'm2-pe2': [['1 2', '12']]
  };

  for (const id in cases) {
    for (const [input, expected] of cases[id]) {
      test(`${id}: "${input}" -> "${expected}"`, () => {
        const p = page();
        p.type(id, input);
        assert.equal(p.el(id).value, expected);
      });
    }
  }

  test('nimikenttään voi kirjoittaa mitä vain', () => {
    const p = page();
    p.type('n', 'Varaaja 1,5 kW (-avg)');
    assert.equal(p.el('n').value, 'Varaaja 1,5 kW (-avg)');
  });

  test('maskin läpäisevät arvot tallentuvat lukuina', async () => {
    const p = page({ mode: 1 });
    p.el('mode').value = '1';
    p.type('m1-lim', '-2,5');
    assert.equal((await p.save()).m1.l, -2.5);
    p.type('m1-lim', 'AVG');
    assert.equal((await p.save()).m1.l, 'avg');
  });
});

describe('tilasivu: varoitus puuttuvasta lähdöstä', () => {
  const TAB_STATUS = fs.readFileSync(path.join(__dirname, '..', 'src', 'statics', 'tab-status.js'), 'utf8');

  /** Ajaa tilasivun koodin annetulla tilalla ja palauttaa sivun elementit */
  function statusPage(state) {
    const elements = {};
    const pad = (n) => String(n).padStart(2, '0');
    const context = vm.createContext({
      ...uiShared(),
      state,
      inst: 0,
      CBS: [],
      console,
      qs: (id) => elements[id] ?? (elements[id] = { innerHTML: '', style: {} }),
      MODE_STR: ['mode0', 'mode1', 'mode2'],
      STATE_STR: new Array(14).fill('tila'),
      formatTime: (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      formatDateTime: (d) => d.toISOString()
    });
    vm.runInContext(TAB_STATUS, context, { filename: 'tab-status.js' });
    return elements;
  }

  test('käytössä oleva ohjaus ilman lähtöjä näyttää varoituksen', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 }, o: [] } });
    const el = statusPage(sim.status(0));

    assert.match(el['s-cmd'].innerHTML, /^PÄÄLLÄ – lähtöä ei ole määritetty$/);
    assert.equal(el['s-cmd'].style.color, 'orange');
    assert.match(el['s-st'].innerHTML, /Ohjaus ei kytke mitään lähtöä/);
  });

  test('olematon lähtö näyttää varoituksen', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 }, o: [7] } });
    const el = statusPage(sim.status(0));

    assert.match(el['s-cmd'].innerHTML, /^PÄÄLLÄ – lähtöä 7 ei löydy laitteesta$/);
    assert.equal(el['s-cmd'].style.color, 'orange');
    assert.match(el['s-st'].innerHTML, /Lähtöä 7 ei ole tässä laitteessa/);
  });

  test('korostettu rivi ja hinta nyt seuraavat laitteen kelloa, eivät selaimen', () => {
    //Laitteen kello on 5.10.2026 klo 10:20 - testikoneen oikea kello on jotain muuta
    const price = (e, d) => d.getHours() + d.getMinutes() / 100;
    const bold = (el) => (el['s-pa'].innerHTML + el['s-pb'].innerHTML).split('<tr style=').slice(1)
      .filter(r => r.includes('font-weight:bold')).map(r => r.match(/class="fit">(\d\d:\d\d)/)[1]);

    let sim = boot({ start: '2026-10-05T10:20:00', inst: { mode: 0, m0: { c: 1 } }, price });
    assert.deepEqual(bold(statusPage(sim.status(0))), ['10:00'], 'tuntitila');

    sim = boot({ start: '2026-10-05T10:20:00', inst: { mode: 0, m0: { c: 1 }, q: 1 }, price });
    const el = statusPage(sim.status(0));
    assert.deepEqual(bold(el), ['10:15'], 'varttitila');
    assert.equal(el['s-now'].innerHTML, '10.15 c/kWh (15 min)');
  });

  test('lähtö määritetty: ei varoitusta', () => {
    const sim = boot({ inst: { mode: 0, m0: { c: 1 }, o: [0] } });
    const el = statusPage(sim.status(0));

    assert.equal(el['s-cmd'].innerHTML, 'PÄÄLLÄ');
    assert.equal(el['s-cmd'].style.color, 'green');
    assert.doesNotMatch(el['s-st'].innerHTML, /lähtöä/);
  });

  test('ohjaus pois käytöstä: ei varoitusta', () => {
    const sim = boot({ inst: { en: 0, o: [] } });
    const el = statusPage(sim.status(0));

    assert.doesNotMatch(el['s-cmd'].innerHTML, /lähtöä ei ole/);
  });
});

describe('asetussivu: siirtotuote (v10)', () => {
  const pageWith = (common) => configPage(boot({ inst: { mode: 0 }, common }).status(0));
  const commonSaved = (p) => {
    const call = p.calls.find(c => c.includes('KVS.Set?key="porssisahko"'));
    return call ? kvsUnpack(-1, kvsValue(call)) : null;
  };

  test('aikasiirto: valinta ja maksujen kellonajat', () => {
    const p = pageWith({});
    assert.equal(p.el('tt').value, 0);
    assert.equal(p.el('tt-d').innerHTML, '(joka päivä 07-22)');
    assert.equal(p.el('tt-n').innerHTML, '(joka päivä 22-07)');
  });

  test('kausisiirto: kausi, viikonpäivät ja kellonajat näkyvät maksujen kohdalla', () => {
    const p = pageWith({ tt: 1 });
    assert.equal(p.el('tt').value, 1);
    assert.equal(p.el('tt-d').innerHTML, '(1.11. - 31.3. ma-la 07-22)');
    assert.equal(p.el('tt-n').innerHTML, '(muu aika)');
  });

  test('tekstit vaihtuvat valinnan mukaan ennen tallennusta, ja omat päivät ja kellonajat näkyvät', () => {
    const p = pageWith({ ss: 1115, se: 315, ds: 6, de: 21 });
    assert.equal(p.el('tt-d').innerHTML, '(joka päivä 06-21)');
    p.change('tt', '1');
    assert.equal(p.el('tt-d').innerHTML, '(15.11. - 15.3. ma-la 06-21)');
    assert.equal(p.el('tt-n').innerHTML, '(muu aika)');
    p.change('tt', '0');
    assert.equal(p.el('tt-n').innerHTML, '(joka päivä 21-06)');
  });

  test('muut kaudet ja kellonajat näkyvät oikein', () => {
    assert.equal(pageWith({ tt: 1, ss: 1010, se: 215, ds: 9, de: 14 }).el('tt-d').innerHTML, '(10.10. - 15.2. ma-la 09-14)');
    assert.equal(pageWith({ tt: 1, ss: 810, se: 229, ds: 6, de: 18 }).el('tt-d').innerHTML, '(10.8. - 29.2. ma-la 06-18)');
    assert.equal(pageWith({ ds: 6, de: 18 }).el('tt-n').innerHTML, '(joka päivä 18-06)');
  });

  test('tallennus: valinta tallentuu, ja skriptillä asetetut päivät ja kellonajat säilyvät', async () => {
    const p = pageWith({ ss: 1115, se: 315, ds: 6, de: 21 });
    p.change('tt', '1');
    await p.save();
    const c = commonSaved(p);
    assert.ok(c, 'yleiset asetukset tallennettiin');
    assert.deepEqual([c.tt, c.ss, c.se, c.ds, c.de], [1, 1115, 315, 6, 21]);
  });
});
