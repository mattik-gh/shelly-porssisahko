/**
 * Ajaa skriptiä simulaattorissa ja tarjoaa sen käyttöliittymän selaimelle.
 *
 * Käyttö:
 *   node test/serve.js [--port 8080] [--speed 1] [--start 2026-10-05T10:00:00] [--script tiedosto.js] [--name Simu]
 *   --name -  laitteen nimi tyhjä (kuten Shellyssä, jolle ei ole annettu nimeä)
 *
 * Avaa sitten http://127.0.0.1:8080/script/1
 * (HUOM: ei "localhost" - käyttöliittymä siirtyy silloin kehitystilaan)
 *
 * Simulaattorin ohjaus selaimella tai curlilla:
 *   /sim                    tila (kello, lähdöt, viimeisimmät lokirivit)
 *   /sim?advance=3600       siirtää kelloa eteenpäin (sekunteja), ajastimet ajetaan
 *   /sim?time=2026-10-25T02:59:00   hyppäyttää kellon (kuten NTP-korjaus)
 *   /sim?speed=60           kellon nopeus (60 = minuutti sekunnissa, 0 = pysäytetty)
 *   /sim?net=error          Elering: ok | error | timeout | <HTTP-statuskoodi>
 *   /sim?synced=0           kellonaika ei tiedossa (1 = tiedossa)
 *   /sim?switchfail=1       lähtöjen ohjaus epäonnistuu (0 = toimii)
 *   /sim?temp=-12           lämpötila-anturin temperature:100 arvo
 */
//"node --test" ajaa kaikki test/-hakemiston .js-tiedostot -> ei käynnistetä palvelinta testiajossa
if (process.env.NODE_TEST_CONTEXT) {
  process.exit(0);
}

process.env.SIM_LOG = process.env.SIM_LOG ?? '1';

const http = require('node:http');
const { createSim } = require('./sim/shelly-sim');

const args = {};
process.argv.slice(2).forEach((arg, i, all) => {
  if (arg.startsWith('--')) {
    args[arg.substring(2)] = all[i + 1];
  }
});

const PORT = Number(args.port ?? 8080);
let speed = Number(args.speed ?? 1);

const sim = createSim({
  start: args.start ?? Date.now(),
  script: args.script,
  deviceName: args.name === '-' ? '' : args.name
});

//Kello etenee oikean ajan mukaan (nopeudella kerrottuna)
let last = Date.now();

function tick() {
  let elapsed = Date.now() - last;
  last += elapsed;

  if (speed > 0) {
    sim.advance(elapsed * speed);
  }
}
setInterval(tick, 100);

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

/** Shelly RPC: parametrit ovat JSON-arvoja, esim. key="porssi-1" */
function rpcParams(url) {
  let params = {};

  url.searchParams.forEach((value, key) => {
    try {
      params[key] = JSON.parse(value);
    } catch (err) {
      //Käyttöliittymä lähettää JSON-asetukset lainausmerkeissä ilman sisäisten merkkien suojausta
      //(value="{"en":1}") - Shelly hyväksyy tämän, joten puretaan samoin
      params[key] = /^".*"$/s.test(value) ? value.substring(1, value.length - 1) : value;
    }
  });
  return params;
}

function control(url, res) {
  let q = url.searchParams;

  if (q.has('advance')) {
    sim.advance(Number(q.get('advance')) * 1000);
  }
  if (q.has('time')) {
    sim.setTime(q.get('time'));
  }
  if (q.has('speed')) {
    speed = Number(q.get('speed'));
  }
  if (q.has('net')) {
    sim.net.mode = isNaN(Number(q.get('net'))) ? q.get('net') : Number(q.get('net'));
  }
  if (q.has('synced')) {
    sim.timeSynced = q.get('synced') !== '0';
  }
  if (q.has('switchfail')) {
    sim.switchFail = q.get('switchfail') === '1';
  }
  if (q.has('temp')) {
    sim.components['temperature:100'] = { id: 100, tC: Number(q.get('temp')) };
  }

  json(res, 200, {
    time: sim.now().toString(),
    speed,
    timeSynced: sim.timeSynced,
    net: sim.net.mode,
    switchFail: sim.switchFail,
    relays: sim.relays,
    crashed: sim.crashed ? String(sim.crashed.stack ?? sim.crashed) : null,
    priceFetches: sim.httpLog.length,
    kvs: Object.fromEntries(sim.kvs),
    log: sim.logs.slice(-20).map(l => `${new Date(l.t).toLocaleTimeString('sv-SE')} ${l.msg}`)
  });
}

http.createServer((req, res) => {
  let url = new URL(req.url, `http://${req.headers.host}`);

  //Käyttöliittymä päättelee kehitystilan osoitteesta -> ohjataan pois localhostista
  if (url.hostname === 'localhost') {
    res.writeHead(302, { Location: `http://127.0.0.1:${PORT}${req.url}` });
    return res.end();
  }

  tick();

  if (url.pathname === '/' || url.pathname === '/script') {
    res.writeHead(302, { Location: '/script/1' });
    return res.end();
  }

  if (url.pathname === '/sim') {
    return control(url, res);
  }

  if (url.pathname === '/rpc/KVS.Set') {
    let params = rpcParams(url);
    sim.kvs.set(params.key, typeof params.value === 'string' ? params.value : JSON.stringify(params.value));
    return json(res, 200, { etag: 'sim', rev: 1 });
  }

  if (url.pathname === '/rpc/KVS.Get') {
    let params = rpcParams(url);

    if (!sim.kvs.has(params.key)) {
      return json(res, 404, { code: -105, message: `Argument 'key', value '${params.key}' not found !` });
    }
    return json(res, 200, { etag: 'sim', value: sim.kvs.get(params.key) });
  }

  let match = url.pathname.match(/^\/script\/1\/?(.*)$/);

  if (match) {
    let result = sim.request(url.search.substring(1), match[1]);

    if (!result.sent) {
      res.writeHead(sim.crashed ? 500 : 404);
      return res.end(sim.crashed ? 'Skripti on pysähtynyt: ' + sim.crashed : '');
    }

    let headers = {};
    result.headers.forEach(h => headers[h[0]] = h[1]);
    res.writeHead(result.code, headers);
    return res.end(Buffer.from(result.body, 'latin1'));
  }

  res.writeHead(404);
  res.end();

}).listen(PORT, '127.0.0.1', () => {
  console.log(`Simulaattori käynnissä: http://127.0.0.1:${PORT}/script/1`);
  console.log(`Ohjaus:                 http://127.0.0.1:${PORT}/sim`);
});
