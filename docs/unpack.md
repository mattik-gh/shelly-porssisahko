# Hintojen ja historian purku ulkoisessa ohjelmassa

Versiossa 10 hinnat ja historia palautetaan HTTP-rajapinnasta pakattuina base64-merkkijonoina: hinnat tilan lukemisen (`?r=s`) kentässä `p`, historia omalla pyynnöllään (`?r=h`). Versio 3.4.0 palautti ne taulukoina. Muutoksen syy on laitteen muisti: 15 minuutin hinnat kahdelta päivältä eivät mahtuisi laitteen muistiin taulukoina, eikä laite voi muodostaa purettua vastausta ilman, että sivun lataus veisi muistin loppumisen rajalle (ks. [vertailu-3.4.0.md](vertailu-3.4.0.md)).

Alla on valmiit funktiot, joilla ulkoinen ohjelma voi purkaa pakatut 15 minuutin hintatiedot riveiksi `[aika, hinta]` ja tarvittaessa laskea niistä edelleen 30 tai 60 minuutin keskiarvot. 60 minuutin keskiarvot vastaavat version 3.4.0 muotoa. Historian purkuun on oma funktionsa. Koodi on JavaScriptiä ja toimii sellaisenaan selaimessa ja Node.js:ssä. Samat funktiot on helppo kirjoittaa muillekin kielille.

Funktiot testataan automaattisesti skriptiä vasten (`test/unpack-doc.test.js`), joten ne pysyvät yhtäpitävinä skriptin oman laskennan kanssa.

## Pakatut muodot

**Hinnat** (`p[0]` tänään, `p[1]` huomenna): 3 tavua per hintajakso, kokonaisluku `tavu0 << 16 | tavu1 << 8 | tavu2` miinus 8 388 608. Luku on pörssihinta ilman veroja yksikössä 0,01 EUR/MWh (= 0,001 c/kWh). Jakson alkuhetki on `s.p[n].st` (Unix-aikaleima) ja pituus `s.p[n].sl` sekunteina (900 = 15 min). Hintaan lisätään ALV vain, jos hinta on positiivinen, ja siirtomaksu kellonajan mukaan: päivä klo 07-22, yö klo 22-07. ALV ja siirtomaksut ovat yleisissä asetuksissa `c.vat`, `c.day` ja `c.night`.

**Historia** (`?r=h`): 4 tavua per rivi. Kolme ensimmäistä tavua ovat minuutit hetkestä 8.6.2019 (26 000 000 minuuttia Unix-ajan alusta), neljännen tavun bitti 4 on ohjaus (1 = päälle) ja alimmat neljä bittiä tilan numero (sama kuin `si.st`). Jos rivi on kirjattu ennen kuin laite on saanut kellonajan, minuuttikenttä sisältää minuutit laitteen käynnistyksestä (alle 100 000), eikä aikaa tiedetä.

## Funktiot

```js
/**
 * Unpacks the prices of one day to rows [epoch, price] - one row for each price slot (15 min).
 * Price is c/kWh with VAT and transfer fee, as in version 3.4.0 (which had one row for each hour).
 *
 * @param {string} packed state.p[0] or state.p[1] (base64)
 * @param {number} start state.s.p[n].st - start time of the day (epoch, seconds)
 * @param {number} slot state.s.p[n].sl - length of one slot (seconds, 900 = 15 min)
 * @param {number} vat state.c.vat - VAT [%] (added only to positive prices)
 * @param {number} day state.c.day - day transfer fee [c/kWh]
 * @param {number} night state.c.night - night transfer fee [c/kWh]
 * @param {object} [c] state.c - transfer product and its days and hours (tt, ss, se, ds, de; new in version 10).
 *   Without it: day fee every day 07-22, as in version 3.4.0
 * @returns {Array<[number, number]>} rows [epoch, price c/kWh]
 */
function unpackPrices(packed, start, slot, vat, day, night, c = {}) {
  const tt = c.tt ?? 0, ss = c.ss ?? 1101, se = c.se ?? 331, ds = c.ds ?? 7, de = c.de ?? 22;

  const raw = atob(packed);
  const rows = [];

  for (let i = 0; i < raw.length; i += 3) {
    // Raw price [0.01 EUR/MWh] -> EUR/MWh -> c/kWh
    const price = ((raw.charCodeAt(i) << 16 | raw.charCodeAt(i + 1) << 8 | raw.charCodeAt(i + 2)) - 8388608) / 100 / 10;
    const epoch = start + (i / 3) * slot;
    const date = new Date(epoch * 1000);
    const hour = date.getHours();
    // Seasonal transfer (tt 1): day fee only in the season (ss...se as month * 100 + day, also over the turn of the year)
    // on Monday...Saturday. Time-of-day transfer (tt 0): day fee every day
    const md = (date.getMonth() + 1) * 100 + date.getDate();
    const season = ss <= se ? md >= ss && md <= se : md >= ss || md <= se;
    const dayFee = !tt || (season && date.getDay() != 0);
    const fee = (dayFee && hour >= ds && hour < de) ? day : night;

    rows.push([epoch, price * (100 + (price > 0 ? vat : 0)) / 100 + fee]);
  }
  return rows;
}

/**
 * Averages of the rows returned by unpackPrices() for longer periods.
 * With 3600 (the default) the result has the same format and row count as in version 3.4.0 (one row for each hour);
 * with 1800 the result has 30 minute averages, as the script uses with the 30 min price resolution.
 * The last period of the day may be incomplete (clock change days); its average uses the slots it has.
 *
 * @param {Array<[number, number]>} rows rows from unpackPrices()
 * @param {number} unit length of the period in seconds: 3600 = hour (default), 1800 = 30 min
 * @returns {Array<[number, number]>} rows [epoch of the period, average price c/kWh]
 */
function averageRows(rows, unit = 3600) {
  const periods = [];

  for (const [epoch, price] of rows) {
    const start = Math.floor(epoch / unit) * unit;
    const last = periods[periods.length - 1];

    if (last && last[0] === start) {
      last[1] += price;
      last[2]++;
    } else {
      periods.push([start, price, 1]);
    }
  }
  return periods.map(p => [p[0], p[1] / p[2]]);
}

/**
 * Unpacks the history to rows [epoch, cmd, state] as in version 3.4.0 (oldest first).
 * Time is in minutes, so epoch is a full minute. Epoch is 0 if the row was written before the device had the clock time.
 *
 * @param {string} packed response of ?r=h (base64)
 * @returns {Array<[number, number, number]>} rows [epoch, cmd 0/1, state number]
 */
function unpackHistory(packed) {
  const raw = atob(packed);
  const rows = [];

  for (let i = 0; i < raw.length; i += 4) {
    const minutes = raw.charCodeAt(i) << 16 | raw.charCodeAt(i + 1) << 8 | raw.charCodeAt(i + 2);
    const epoch = minutes < 100000 ? 0 : (minutes + 26000000) * 60;

    rows.push([epoch, raw.charCodeAt(i + 3) >> 4 & 1, raw.charCodeAt(i + 3) & 15]);
  }
  return rows;
}
```

## Käyttö

```js
const base = "http://192.168.1.50/script/1";
const state = await (await fetch(`${base}?r=s&i=0`)).json();

// Today's prices for each 15 min slot, as hourly rows like in version 3.4.0, and as 30 minute averages
const today = unpackPrices(state.p[0], state.s.p[0].st, state.s.p[0].sl, state.c.vat, state.c.day, state.c.night, state.c);
const todayHourly = averageRows(today);
const todayHalfHours = averageRows(today, 1800);

// Tomorrow's prices (empty until they have been fetched, after 15:00)
const tomorrow = state.p[1] ? unpackPrices(state.p[1], state.s.p[1].st, state.s.p[1].sl, state.c.vat, state.c.day, state.c.night, state.c) : [];

// History of control #1
const history = unpackHistory(await (await fetch(`${base}?r=h&i=0`)).text());
```

Huomioita:

- Hinnat ovat 0,001 c/kWh:n tarkkuudella ennen ALV:n ja siirron lisäystä. Versio 3.4.0 antoi täydet desimaalit, joten tulokset voivat erota neljännessä desimaalissa.
- Tunnin ja 30 minuutin keskiarvot lasketaan jaksojen hinnoista ALV:n ja siirron kanssa, täsmälleen kuten skripti tekee tunnin ja 30 minuutin tarkkuudella ohjatessaan.
- Historian ajat ovat minuutin tarkkuudella (3.4.0: sekunnin).
- Laite vastaa koodilla 503, jos skripti on juuri ajamassa logiikkaa. Yritä silloin hetken kuluttua uudelleen.
