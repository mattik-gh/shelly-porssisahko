/**
 * TESTIRAJAPINTA laitetestin kellonsiirtotesteille (node test/device/run.js <osoite> --dst). EI JULKAISTA.
 *
 * Shelly-skripti, joka vastaa Eleringin hintarajapinnan tavoin (CSV) tuntihinnoilla pyydetylle aikavälille.
 * Laitetesti asentaa sen toiseksi skriptiksi ja lataa pääskriptistä kopion, jossa hakuosoite on
 *   http://localhost/script/<tämän skriptin numero>/prices?fields=fi&start=...&end=...
 * Näin kelloa voi siirtää tuleviin kellonsiirtopäiviin, joille Eleringillä ei vielä ole hintoja.
 *
 * Vastaus on samassa muodossa kuin Eleringillä (ks. test/sim/elering.js):
 *   "Ajatempel (UTC)";"Kuupäev (Eesti aeg)";"NPS fi"
 *   "1792875600";"25.10.2026 00:00";"30"
 * - rivit tunnin välein alkuhetkestä loppuhetkeen asti (molemmat mukaan), kuten Eleringin rajapinnassa
 * - päivämäärä ja kellonaika Viron (= Suomen) aikaa EU:n kesäaikasäännöllä: kesäaika (UTC+3) maaliskuun viimeisen
 *   sunnuntain klo 01 UTC:stä lokakuun viimeisen sunnuntain klo 01 UTC:hen, muulloin UTC+2. Laskettu itse, koska laite
 *   laskee kaikki päivämäärät nykyisellä poikkeamalla eikä tiedä tulevasta kellonsiirrosta
 * - hinta EUR/MWh kellonajan mukaan (FAKE_PRICES), joten kellonsiirtopäivänä toistuva tunti saa saman hinnan
 *
 * Huom: Shellyn tulkki - vain nimetyt funktiot (ei sisäkkäisiä nimettömiä funktioita), ei hoisting-oletuksia.
 * Simulaattorissa vastaus tarkistetaan merkki merkiltä Elering-mallia vastaan (test/fake-elering.test.js).
 */

/** Hinnat EUR/MWh kellonajan mukaan (00...23) */
let FAKE_PRICES = [30, 25, 20, 18, 17, 19, 40, 80, 90, 70, 60, 50, 45, 40, 42, 48, 60, 90, 110, 100, 80, 60, 45, 35];

/** Pyyntöjen määrä (laitetesti lukee sen Script.Eval-kutsulla) */
let fakeCount = 0;

/** Päivien määrä 1.1.1970 lähtien (gregoriaaninen kalenteri) - Date.UTC:ta ei käytetä */
function fakeDays(y, m, d) {
  if (m <= 2) {
    y = y - 1;
  }
  let era = Math.floor(y / 400);
  let yoe = y - era * 400;
  let doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  let doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** Aikaleima (s) tekstistä 2026-10-25T00:00:00%2b03:00 (tai +03:00 / -01:00) */
function fakeEpoch(s) {
  let sign = s.indexOf("-", 19) >= 0 ? -1 : 1;
  let off = s.substring(s.length - 5);
  let res = fakeDays(Number(s.substring(0, 4)), Number(s.substring(5, 7)), Number(s.substring(8, 10))) * 86400
    + Number(s.substring(11, 13)) * 3600 + Number(s.substring(14, 16)) * 60 + Number(s.substring(17, 19));
  return res - sign * (Number(off.substring(0, 2)) * 3600 + Number(off.substring(3, 5)) * 60);
}

/** Päivämäärä päivien määrästä 1.1.1970 lähtien: [vuosi, kuukausi 1-12, päivä] */
function fakeCivil(z) {
  z = z + 719468;
  let era = Math.floor(z / 146097);
  let doe = z - era * 146097;
  let yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  let doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  let mp = Math.floor((5 * doy + 2) / 153);
  let m = mp + (mp < 10 ? 3 : -9);
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, doy - Math.floor((153 * mp + 2) / 5) + 1];
}

/** Kuukauden viimeinen sunnuntai klo 01 UTC (aikaleima, s) */
function fakeLastSunday(y, m) {
  let last = (m == 12 ? fakeDays(y + 1, 1, 1) : fakeDays(y, m + 1, 1)) - 1;
  //1.1.1970 oli torstai (4), sunnuntai = 0
  return (last - (last + 4) % 7) * 86400 + 3600;
}

/** Viron ja Suomen paikallinen aika: [vuosi, kuukausi, päivä, tunti, minuutti] */
function fakeLocal(ts) {
  let y = fakeCivil(Math.floor(ts / 86400))[0];
  let local = ts + (ts >= fakeLastSunday(y, 3) && ts < fakeLastSunday(y, 10) ? 3 : 2) * 3600;
  let d = fakeCivil(Math.floor(local / 86400));
  let sec = local - Math.floor(local / 86400) * 86400;
  return [d[0], d[1], d[2], Math.floor(sec / 3600), Math.floor(sec % 3600 / 60)];
}

function fakePad(n) {
  return (n < 10 ? "0" : "") + n;
}

/** Hakee parametrin arvon kyselystä (esim. "start") */
function fakeParam(query, name) {
  let parts = query.split("&");
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].indexOf(name + "=") === 0) {
      return parts[i].substring(name.length + 1);
    }
  }
  return "";
}

function fakeRequest(request, response) {
  fakeCount++;
  let query = request.query || "";
  let fields = fakeParam(query, "fields");
  let start = fakeEpoch(fakeParam(query, "start"));
  let end = fakeEpoch(fakeParam(query, "end"));
  let body = '"Ajatempel (UTC)";"Kuupäev (Eesti aeg)";"NPS ' + fields + '"';

  for (let ts = start; ts <= end; ts += 3600) {
    let t = fakeLocal(ts);
    body += '\n"' + ts + '";"' + fakePad(t[2]) + "." + fakePad(t[1]) + "." + t[0]
      + " " + fakePad(t[3]) + ":" + fakePad(t[4]) + '";"' + FAKE_PRICES[t[3]] + '"';
  }

  response.code = 200;
  response.headers = [["Content-Type", "application/octet-stream"]];
  response.body = body + "\n";
  response.send();
}

HTTPServer.registerEndpoint("prices", fakeRequest);
