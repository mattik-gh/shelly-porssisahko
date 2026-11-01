/**
 * Elering-rajapinnan (dashboard.elering.ee/api/nps/price/csv) simulaatio.
 *
 * Muoto vastaa oikeaa rajapintaa (ks. test/fixtures):
 *
 *   "Ajatempel (UTC)";"Kuupäev (Eesti aeg)";"NPS Soome"
 *   "1790974800";"03.10.2026 00:00";"31,93"
 *   "1790975700";"03.10.2026 00:15";"28,19"
 *
 * - hinta on EUR/MWh, desimaalierottimena pilkku, kokonaisluvut ilman desimaaleja
 * - viimeisen rivin perässä on rivinvaihto
 */

/**
 * Oletushinta [c/kWh ilman veroja] - halpa yö, kallis aamu ja ilta
 */
const DEFAULT_HOURLY = [
  3, 2, 1, 1.5, 2.5, 4, //00-05
  8, 12, 14, 11, 9, 7, //06-11
  6, 5, 5.5, 6.5, 9, 13, //12-17
  16, 15, 12, 9, 6, 4 //18-23
];

function defaultPrice(epoch, date) {
  return DEFAULT_HOURLY[date.getHours()];
}

/**
 * Tekee hintafunktion 24 tuntihinnan taulukosta (indeksi = paikallinen tunti)
 */
function hourly(prices) {
  return (epoch, date) => prices[date.getHours()];
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Muodostaa CSV-vastauksen skriptin tekemän pyynnön perusteella
 *
 * @param {string} url skriptin pyytämä osoite (start- ja end-parametrit)
 * @param {object} net simulaattorin net-asetukset (price, resolution, maxHours, trailingNewline)
 */
function eleringCsv(url, net) {
  let query = {};

  url.substring(url.indexOf('?') + 1).split('&').forEach(pair => {
    let [key, value] = pair.split('=');
    query[key] = decodeURIComponent(value);
  });

  let start = Math.floor(new Date(query.start).getTime() / 1000);
  let end = Math.floor(new Date(query.end).getTime() / 1000);

  if (isNaN(start) || isNaN(end)) {
    throw new Error(`elering: virheellinen aikaväli pyynnössä ${url}`);
  }

  let step = (net.resolution ?? 15) * 60;
  let rows = [`"Ajatempel (UTC)";"Kuupäev (Eesti aeg)";"NPS ${query.fields}"`];

  if (net.maxHours != null) {
    end = Math.min(end, start + net.maxHours * 3600 - 1);
  }

  for (let ts = start; ts <= end; ts += step) {
    let date = new Date(ts * 1000);
    //c/kWh -> EUR/MWh, enintään kaksi desimaalia, pilkku erottimena
    let price = String(Math.round(net.price(ts, date) * 10 * 100) / 100).replace('.', ',');

    rows.push(`"${ts}";"${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}";"${price}"`);
  }

  return rows.join('\n') + (net.trailingNewline === false ? '' : '\n');
}

module.exports = { eleringCsv, defaultPrice, hourly, DEFAULT_HOURLY };
