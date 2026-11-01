/**
 * Versio shelly-porssisahko-1-instance-no-history.js: yksi ohjaus, ei historiaa (pienin muistinkäyttö)
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('../helpers');
const { loadAddon } = require('../sim/addon-alone');

const script = 'shelly-porssisahko-1-instance-no-history.js';

describe(`${script}: yksin`, () => {
  test('asettaa vain rakennusvakiot, ei omaa toimintaa', () => {
    const addon = loadAddon(script);
    assert.equal(addon.value('INSTANCE_COUNT'), 1);
    assert.equal(addon.value('HIST_LEN'), 0);
    assert.equal(addon.has('USER_CONFIG'), false);
    assert.equal(addon.has('USER_OVERRIDE'), false);
    assert.equal(addon.has('USER_LOOP'), false);
    assert.deepEqual(addon.endpoints(), []);
  });

  test('vakiot määritellään ennen pääkoodia', () => {
    const addon = loadAddon(script);
    const main = addon.source.indexOf('//__REPLACED_WITH_MAIN_CODE__');
    assert.ok(main > addon.source.indexOf('INSTANCE_COUNT') && main > addon.source.indexOf('HIST_LEN'));
  });
});

describe(`${script}: pääskriptin kanssa`, () => {
  test('vain yksi ohjaus on käytössä', () => {
    const sim = boot({ script, inst: { mode: 0, m0: { c: 1 } } });

    //Testi käynnistyy version 3.x asetuksilla (porssi...), jotka skripti lukee ja tallentaa uusiin avaimiin
    assert.deepEqual([...sim.kvs.keys()].sort(), ['porssi', 'porssi-1', 'porssisahko', 'porssisahko-1']);
    assert.equal(sim.relays[0], true);
    assert.equal(sim.get('r=s&i=0').code, 200);
    assert.equal(sim.get('r=s&i=1').json.si, undefined, 'toista ohjausta ei ole');
    assert.equal(sim.status(0).c.cnt, 1);
    assert.equal(sim.evaluate('_.si.length'), 1);
    assert.deepEqual(sim.status(0).c.names, ['-']);
  });
});
