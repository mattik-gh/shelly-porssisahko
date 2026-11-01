/**
 * Lisäosa shelly-porssisahko-addon-temp.js: ohjauksen #1 ylikirjoitus Add-on-anturin lämpötilan mukaan
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { boot, assertAlive } = require('../helpers');
const { loadAddon } = require('../sim/addon-alone');

const script = 'shelly-porssisahko-addon-temp.js';

describe(`${script}: yksin`, () => {
  const sensor = (tC) => ({ 'temperature:100': { tC } });

  test('lisäosa käyttää USER_OVERRIDE- ja USER_LOOP-rajapintoja', () => {
    const addon = loadAddon(script);
    assert.equal(addon.has('USER_OVERRIDE'), true);
    assert.equal(addon.has('USER_LOOP'), true);
    assert.equal(addon.has('USER_CONFIG'), false);
  });

  const cases = [
    //[lämpötila, pörssiohjaus, lopputulos, selite]
    [20, true, false, /yli 15°C -> ohjaus pois/],
    [20, false, false, /mennään ohjauksen mukaan/],
    [15.1, true, false, /yli 15/],
    [15, true, true, /mennään ohjauksen mukaan/],
    [10, true, true, /mennään ohjauksen mukaan/],
    [10, false, false, /mennään ohjauksen mukaan/],
    [5, false, false, /mennään ohjauksen mukaan/],
    [4.9, false, true, /alle 5°C -> ohjaus päälle/],
    [-20, false, true, /alle 5/],
    [-20, true, true, /mennään ohjauksen mukaan/]
  ];

  for (const [temp, cmd, expected, text] of cases) {
    test(`${temp} °C, pörssiohjaus ${cmd ? 'päällä' : 'pois'} -> ${expected ? 'päälle' : 'pois'}`, () => {
      const addon = loadAddon(script, { components: sensor(temp) });
      const res = addon.override(0, cmd);

      assert.equal(res.count, 1, 'vastataan täsmälleen kerran');
      assert.equal(res.value, expected);
      assert.match(addon.state.si[0].str, text);
    });
  }

  test('anturi puuttuu: pörssiohjaus sellaisenaan ja virheteksti', () => {
    for (const cmd of [true, false]) {
      const addon = loadAddon(script);
      const res = addon.override(0, cmd);
      assert.equal(res.count, 1);
      assert.equal(res.value, cmd);
      assert.match(addon.state.si[0].str, /virhe.*anturia 100 ei löytynyt/i);
    }
  });

  test('anturi ei anna lukemaa: pörssiohjaus sellaisenaan ja virheteksti', () => {
    const addon = loadAddon(script, { components: sensor(null) });
    const res = addon.override(0, true);
    assert.equal(res.count, 1);
    assert.equal(res.value, true);
    assert.match(addon.state.si[0].str, /Onko anturi kytketty/);
  });

  //Lukema vaihdetaan testin aikana; sys.uptime on laitteen käyntiaika sekunteina
  const withSensor = (tC, uptime = 1000) => {
    const addon = loadAddon(script, { components: { 'temperature:100': { tC }, sys: { uptime } } });
    addon.setTemp = (v) => { addon.components['temperature:100'] = { tC: v }; };
    addon.setUptime = (v) => { addon.components.sys = { uptime: v }; };
    addon.loop = () => { addon.value('loopRunning = true'); addon.value('USER_LOOP()'); return addon.value('loopRunning'); };
    return addon;
  };

  test('hystereesi ylärajalla: ohitus päättyy vasta 14.5 °C:ssa', () => {
    const addon = withSensor(20);
    assert.equal(addon.override(0, true).value, false, '20 °C -> pois');

    addon.setTemp(14.8);
    assert.equal(addon.override(0, true).value, false, '14.8 °C -> yhä pois');
    assert.match(addon.state.si[0].str, /14.8°C ei ole vielä laskenut 14.5 asteeseen -> ohjaus pois/);

    addon.setTemp(14.6);
    assert.equal(addon.override(0, true).value, false, '14.6 °C -> yhä pois');

    addon.setTemp(14.5);
    assert.equal(addon.override(0, true).value, true, '14.5 °C -> pörssiohjauksen mukaan');
    assert.match(addon.state.si[0].str, /mennään ohjauksen mukaan/);
  });

  test('hystereesi alarajalla: ohitus päättyy vasta 5.5 °C:ssa', () => {
    const addon = withSensor(2);
    assert.equal(addon.override(0, false).value, true, '2 °C -> päälle');

    addon.setTemp(5.3);
    assert.equal(addon.override(0, false).value, true, '5.3 °C -> yhä päälle');
    assert.match(addon.state.si[0].str, /5.3°C ei ole vielä noussut 5.5 asteeseen -> ohjaus päälle/);

    addon.setTemp(5.5);
    assert.equal(addon.override(0, false).value, false, '5.5 °C -> pörssiohjauksen mukaan');
  });

  test('hystereesi: suora siirtymä ylärajalta alarajalle ja takaisin', () => {
    const addon = withSensor(20);
    assert.equal(addon.override(0, true).value, false);
    addon.setTemp(-5);
    assert.equal(addon.override(0, false).value, true, 'yläraja ei jää voimaan');
    addon.setTemp(30);
    assert.equal(addon.override(0, true).value, false, 'alaraja ei jää voimaan');
  });

  test('hystereesi 0: toimii kuten rajat ilman hystereesiä', () => {
    const addon = withSensor(20);
    addon.value('TEMP_HYST = 0');
    assert.equal(addon.override(0, true).value, false);
    addon.setTemp(15);
    assert.equal(addon.override(0, true).value, true);
  });

  test('USER_LOOP vapauttaa pääskriptin silmukan kaikissa tilanteissa', () => {
    const cases = [
      ['lukema ok, ei muutosta', (a) => { a.override(0, true); }],
      ['lukema muuttui', (a) => { a.override(0, true); a.setTemp(30); }],
      ['anturi puuttuu', (a) => { delete a.components['temperature:100']; }],
      ['lukema puuttuu', (a) => { a.setTemp(null); }],
      ['käyntiaika puuttuu', (a) => { a.override(0, true); a.setTemp(30); delete a.components.sys; }],
      ['ohjaus pois käytöstä', (a) => { a.state.c.i[0].en = 0; }],
      ['reagointi pois asetuksista', (a) => { a.value('TEMP_REACT = false'); }],
      ['virhe: tila puuttuu', (a) => { a.value('_ = {}'); }],
      ['virhe: getComponentStatus heittää', (a) => { a.value('Shelly.getComponentStatus = function () { throw new Error("x"); }'); }]
    ];
    for (const [name, setup] of cases) {
      const addon = withSensor(10);
      setup(addon);
      assert.equal(addon.loop(), false, name);
    }
  });

  test('USER_LOOP pyytää tarkistuksen, kun rajan ohitus muuttuu', () => {
    const addon = withSensor(10);
    addon.override(0, true);
    addon.loop();
    assert.equal(addon.state.si[0].chkTs, 1000, 'ei muutosta -> ei pyyntöä');

    addon.setTemp(14.9);
    addon.loop();
    assert.equal(addon.state.si[0].chkTs, 1000, 'rajan alla -> ei pyyntöä');

    addon.setTemp(15.2);
    addon.loop();
    assert.equal(addon.state.si[0].chkTs, 0, 'yläraja ylittyi -> tarkistus');
  });

  test('USER_LOOP: hystereesin sisällä heiluva lukema ei pyydä tarkistusta', () => {
    const addon = withSensor(20);
    addon.override(0, true);
    for (const t of [14.6, 15, 14.9, 15.1, 14.7, 15.3, 14.51]) {
      addon.setTemp(t);
      addon.loop();
      assert.equal(addon.state.si[0].chkTs, 1000, `${t} °C`);
    }
  });

  test('USER_LOOP: vähimmäisväli rajoittaa pyyntöjä', () => {
    const addon = withSensor(10, 1000);
    addon.override(0, true);
    addon.setTemp(20);
    addon.loop();
    assert.equal(addon.state.si[0].chkTs, 0, 'ensimmäinen pyyntö heti');

    //Pääskripti tarkistaa ohjauksen; sitten lämpötila putoaa alarajan alle
    addon.state.si[0].chkTs = 2000;
    addon.override(0, true);
    addon.setTemp(2);
    addon.setUptime(1000 + 299);
    addon.loop();
    assert.equal(addon.state.si[0].chkTs, 2000, 'alle 5 min edellisestä -> ei vielä');

    addon.setUptime(1000 + 300);
    addon.loop();
    assert.equal(addon.state.si[0].chkTs, 0, '5 min kulunut -> tarkistus');
  });

  test('USER_LOOP: puuttuva lukema ei muuta tilaa, palaava lukema tarkistaa ohjauksen', () => {
    const addon = withSensor(20);
    addon.override(0, true);
    addon.setTemp(null);
    addon.loop();
    assert.equal(addon.state.si[0].chkTs, 1000, 'puuttuva lukema -> ei pyyntöä');
    assert.equal(addon.value('tempZone'), 1, 'tila säilyy');

    //Pääskripti tarkistaa ohjauksen, kun lukemaa ei ole -> seuraava kelvollinen lukema tarkistaa uudelleen
    addon.override(0, true);
    addon.setTemp(20);
    addon.loop();
    assert.equal(addon.state.si[0].chkTs, 0);
  });

  test('USER_LOOP: ohjaus pois käytöstä tai reagointi pois -> ei pyyntöjä', () => {
    for (const setup of [(a) => { a.state.c.i[0].en = 0; }, (a) => { a.value('TEMP_REACT = false'); }]) {
      const addon = withSensor(10);
      addon.override(0, true);
      setup(addon);
      addon.setTemp(30);
      addon.loop();
      assert.equal(addon.state.si[0].chkTs, 1000);
    }
  });

  test('anturin numero on asetus (TEMP_SENSOR): anturi 101', () => {
    const addon = loadAddon(script, { components: { 'temperature:101': { tC: 20 }, sys: { uptime: 1000 } } });
    assert.equal(addon.override(0, true).value, true, 'oletus 100: anturia ei ole');
    assert.match(addon.state.si[0].str, /anturia 100 ei löytynyt/);

    addon.value('TEMP_SENSOR = 101');
    assert.equal(addon.override(0, true).value, false, 'anturin 101 lukema käytössä');

    //USER_LOOP lukee samaa anturia
    addon.components['temperature:101'] = { tC: 2 };
    addon.value('USER_LOOP()');
    assert.equal(addon.state.si[0].chkTs, 0);
  });

  test('muihin ohjauksiin ei kosketa', () => {
    const addon = loadAddon(script, { components: sensor(20) });
    for (const inst of [1, 2]) {
      const res = addon.override(inst, true);
      assert.equal(res.count, 1);
      assert.equal(res.value, true);
      assert.equal(addon.state.si[inst].str, '');
    }
    assert.equal(addon.calls.length, 0, 'ei verkkokutsuja');
  });
});

describe(`${script}: pääskriptin kanssa`, () => {
  test('yli 15 °C: ohjaus pois vaikka pörssiohjaus olisi päällä', () => {
    const sim = boot({ script, inst: { mode: 0, m0: { c: 1 } }, components: { 'temperature:100': { tC: 20 } } });

    assert.equal(sim.relays[0], false);
    assert.equal(sim.status(0).si.st, 12);
    assert.match(sim.status(0).si.str, /yli 15/);
  });

  test('alle 5 °C: ohjaus päälle vaikka pörssiohjaus olisi pois', () => {
    const sim = boot({ script, inst: { mode: 0, m0: { c: 0 } }, components: { 'temperature:100': { tC: 2 } } });

    assert.equal(sim.relays[0], true);
    assert.equal(sim.status(0).si.st, 12);
  });

  test('5-15 °C: mennään pörssiohjauksen mukaan', () => {
    const sim = boot({ script, inst: { mode: 0, m0: { c: 1 } }, components: { 'temperature:100': { tC: 10 } } });

    assert.equal(sim.relays[0], true);
    assert.equal(sim.status(0).si.st, 1);
  });

  test('anturi puuttuu: mennään pörssiohjauksen mukaan', () => {
    const sim = boot({ script, inst: { mode: 0, m0: { c: 1 } } });

    assert.equal(sim.relays[0], true);
    assert.match(sim.status(0).si.str, /virhe/);
  });

  test('lämpötila nousee kesken tunnin: lähtö pois noin 10 sekunnissa', () => {
    const sim = boot({ script, start: '2026-10-06T10:00:30', inst: { mode: 0, m0: { c: 1 } }, components: { 'temperature:100': { tC: 10 } } });
    assert.equal(sim.relays[0], true);

    sim.advanceTo('2026-10-06T10:20:00');
    sim.components['temperature:100'] = { tC: 20 };
    const t0 = sim.now().getTime();
    sim.advance(25000);
    assertAlive(sim);

    assert.equal(sim.relays[0], false);
    assert.equal(sim.status(0).si.st, 12);
    const w = sim.switchLog[sim.switchLog.length - 1];
    assert.ok(w.t - t0 <= 21000, `kirjoitus ${Math.round((w.t - t0) / 1000)} s muutoksesta`);
  });

  test('lämpötila laskee kesken tunnin alle alarajan: lähtö päälle', () => {
    const sim = boot({ script, start: '2026-10-06T10:00:30', inst: { mode: 0, m0: { c: 0 } }, components: { 'temperature:100': { tC: 10 } } });
    assert.equal(sim.relays[0], false);
    sim.advanceTo('2026-10-06T10:20:00');
    sim.components['temperature:100'] = { tC: 2 };
    sim.advance(25000);
    assertAlive(sim);
    assert.equal(sim.relays[0], true);
  });

  test('lämpötila heiluu ylärajalla tunnin ajan: yksi kytkentä, ei rämpytystä', () => {
    const sim = boot({ script, start: '2026-10-06T10:00:30', inst: { mode: 0, m0: { c: 1 } }, components: { 'temperature:100': { tC: 14 } } });
    sim.advanceTo('2026-10-06T10:05:00');
    const from = sim.switchLog.length;

    //15.0 / 15.1 vuorotellen 10 sekunnin välein
    for (let i = 0; i < 360; i++) {
      sim.components['temperature:100'] = { tC: i % 2 ? 15.0 : 15.1 };
      sim.advance(10000);
    }
    assertAlive(sim);

    const writes = sim.switchLog.slice(from);
    const changes = writes.filter((w, k) => k == 0 ? w.on !== true : w.on !== writes[k - 1].on).length;
    assert.equal(sim.relays[0], false);
    assert.equal(changes, 1, 'lähtö kääntyi kerran: ' + writes.map(w => w.on ? 1 : 0).join(''));
    assert.ok(writes.length <= 3, `kirjoituksia ${writes.length}`);
  });

  test('hystereesi 0 ja heiluva lämpötila: vähimmäisväli rajoittaa kytkennät', () => {
    const sim = boot({ script, start: '2026-10-06T10:00:30', inst: { mode: 0, m0: { c: 1 } }, components: { 'temperature:100': { tC: 14 } } });
    sim.evaluate('TEMP_HYST = 0');
    sim.advanceTo('2026-10-06T10:05:00');
    const from = sim.switchLog.length;

    for (let i = 0; i < 360; i++) {
      sim.components['temperature:100'] = { tC: i % 2 ? 15.0 : 15.1 };
      sim.advance(10000);
    }
    assertAlive(sim);

    //Tunnissa enintään 60 / 5 = 12 lämpötilan takia tehtyä tarkistusta + tasatunnin tarkistus
    const writes = sim.switchLog.slice(from).length;
    assert.ok(writes <= 13, `kirjoituksia ${writes}`);
    assert.ok(writes >= 2, 'reagoi silti');
  });

  test('anturi katkeilee: ei ylimääräisiä tarkistuksia, palaava lukema otetaan käyttöön', () => {
    const sim = boot({ script, start: '2026-10-06T10:00:30', inst: { mode: 0, m0: { c: 1 } }, components: { 'temperature:100': { tC: 10 } } });
    sim.advanceTo('2026-10-06T10:05:00');
    const from = sim.switchLog.length;

    for (let i = 0; i < 60; i++) {
      sim.components['temperature:100'] = { tC: i % 2 ? null : 10 };
      sim.advance(10000);
    }
    assert.equal(sim.switchLog.length, from, 'ei kirjoituksia');

    sim.components['temperature:100'] = { tC: 25 };
    sim.advance(25000);
    assertAlive(sim);
    assert.equal(sim.relays[0], false);
  });

  test('silmukka ei jää varatuksi: hintahaku ja HTTP-pyynnöt toimivat koko päivän', () => {
    const sim = boot({ script, start: '2026-10-06T10:00:30', inst: { mode: 1, m1: { l: 999 } }, components: { 'temperature:100': { tC: 10 } } });
    for (let h = 0; h < 30; h++) {
      sim.components['temperature:100'] = { tC: h % 3 == 0 ? 20 : (h % 3 == 1 ? 2 : 10) };
      sim.advance(3600e3);
      assert.equal(sim.get('r=s&i=0').code, 200, `tunti ${h}`);
    }
    assertAlive(sim);
    assert.ok(sim.status(0).s.p[1].ts > 0 || sim.status(0).s.p[0].ts > 0, 'hinnat haettu');
    assert.equal(sim.status(0).s.errTot, 0);
  });

  test('ei vaikuta muihin ohjauksiin', () => {
    const sim = boot({
      script,
      inst: { en: 0 },
      kvs: { 'porssi-2': { en: 1, mode: 0, m0: { c: 1 }, o: [1] } },
      components: { 'temperature:100': { tC: 20 } }
    });

    assert.equal(sim.relays[1], true);
  });
});
