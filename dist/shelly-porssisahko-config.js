/**
 * Tämä skripti päivittää shelly-porssisahko -skriptin asetukset Shellyn KVS-muistiin.
 * 
 * Käyttökohde esim. jos haluaa päivittää asetukset etänä, ilman pääsyä hallintaan, 
 * tai siirtomaksujen ajat poikkeavat yleisestä käytännöstä (ei voi muuttaa UI:ssa).
 * 
 * 1. Asenna skripti erikseen pörssisähkön rinnalle.
 * 2. Ota kommentit pois niistä asetuksista, joita haluat muuttaa.
 *    Eli // rivin alusta pois
 * 3. Muuta asetukset, tallennta ja käynnistä skripti.
 * 4. Valmis! Muut asetukset pysyivät koskemattomina.
 */

//Pörssisähköskriptin numero
let MAIN_SRIPT_NUMBER = 1;

let cfg = {
  //-------------------------------------
  // Yleiset asetukset
  //-------------------------------------
  c: {
    /** Group (country) to get prices from */
    //g: 'fi',

    /** VAT added to spot price [%] */
    //vat: 25.5,

    /** Day (07...22) transfer price [c/kWh] - with seasonal transfer: winter weekday */
    //day: 0,

    /** Night (22...07) transfer price [c/kWh] - with seasonal transfer: other times */
    //night: 0,

    /** Instance names */
    //names: ['yksi', 'kaksi', 'kolme'],

    /** Maximum total number of history rows (0...96) - divided by enabled instance count */
    //hist: 24,

    /** Number of instances in use (1...3) */
    //cnt: 1,

    /** Transfer product: 0 = time-of-day transfer, 1 = seasonal transfer (Finnish "kausisiirto") */
    //tt: 0,

    /** Seasonal transfer: first and last day of the season as month * 100 + day (1101 = 1.11., 331 = 31.3.)
     *  The day fee is used in the season on Monday...Saturday during the day hours, other times the night fee.
     *  Change these only if your network company uses other days (values are not changeable on the settings page)
     *  HUOM: kirjoita ilman etunollaa, esim. 331 eikä 0331. Shelly lukee etunollallisen luvun oktaalilukuna:
     *  0331 olisi 217 eli 17.2., eikä siitä tule virheilmoitusta */
    //ss: 1101,
    //se: 331,

    /** Hours of the day fee: from ds to de (7 and 22 = 07...22) - both transfer products */
    //ds: 7,
    //de: 22
  },
  i:
    [
      //-------------------------------------
      // Ohjaus #1
      //-------------------------------------
      {
        /** Enabled [0/1]*/
        //en: 0,

        /**  
         * Active mode
         * 0: manual mode (on/off toggle)
         * 1: price limit
         * 2: cheapest hours 
        */
        //mode: 0,

        /** Settings for mode 0 (manual) */
        m0: {
          /** Manual relay output command [0/1] */
          //c: 0
        },

        /** Settings for mode 1 (price limit) */
        m1: {
          /** Price limit limit - if price <= relay output command is set on [c/kWh] */
          //l: 0
        },

        /** Settings for mode 2 (cheapest hours) */
        m2: {
          /** Period length (-1 = custom range) [h] (example: 24 -> cheapest hours during 24h) */
          //p: 24,

          /** How many cheapest hours (can have decimals if price resolution is 30 or 15 minutes, for example 1.5) */
          //c: 0,

          /** Always on price limit [c/kWh] */
          //l: -999,

          /** Should the hours be sequential / in a row [0/1] */
          //s: 0,

          /** Maximum price limit [c/kWh] */
          //m: 999,

          /** Custom period start hour */
          //ps: 0,

          /** Custom period end hour */
          //pe: 23,

          /** Custom period 2 start hour */
          //ps2: 0,

          /** Custom period 2 end hour */
          //pe2: 23,

          /** How many cheapest hours (custom period 2) */
          //c2: 0,

          /** Should the hours be sequential / in a row (custom period 2) [0/1] */
          //s2: 0,
        },

        /** Backup hours [binary] (example: 0b111111 = 00, 01, 02, 03, 04, 05) */
        //b: 0b0,

        /** Relay output command if clock time is not known [0/1] */
        //e: 0,

        /** Outputs IDs to use (array of numbers) */
        //o: [0],

        /** Forced hours [binary] (example: 0b110000000000001100001 = 00, 05, 06, 19, 20) */
        //f: 0b0,

        /** Forced hours commands [binary] (example: 0b110000000000001100000 = 05, 06, 19, 20 are forced to on, 00 to off (if forced as in above example "fh" setting) */
        //fc: 0b0,

        /** Invert output [0/1] */
        //i: 0,

        /** How many first minutes of the hour the output should be on [min]*/
        //m: 60,

        /** Output config - when to set output (0 = always after running logic, 1 = only when output changes)*/
        //oc: 0,

        /** Price resolution (0 = average price of the hour, 1 = price of each 15 minutes, 2 = average price of 30 minutes) */
        //q: 0
      },


      //-------------------------------------
      // Ohjaus #2
      //-------------------------------------
      {
        /** Enabled [0/1]*/
        //en: 0,

        /**  
         * Active mode
         * 0: manual mode (on/off toggle)
         * 1: price limit
         * 2: cheapest hours 
        */
        //mode: 0,

        /** Settings for mode 0 (manual) */
        m0: {
          /** Manual relay output command [0/1] */
          //c: 0
        },

        /** Settings for mode 1 (price limit) */
        m1: {
          /** Price limit limit - if price <= relay output command is set on [c/kWh] */
          //l: 0
        },

        /** Settings for mode 2 (cheapest hours) */
        m2: {
          /** Period length (-1 = custom range) [h] (example: 24 -> cheapest hours during 24h) */
          //p: 24,

          /** How many cheapest hours (can have decimals if price resolution is 30 or 15 minutes, for example 1.5) */
          //c: 0,

          /** Always on price limit [c/kWh] */
          //l: -999,

          /** Should the hours be sequential / in a row [0/1] */
          //s: 0,

          /** Maximum price limit [c/kWh] */
          //m: 999,

          /** Custom period start hour */
          //ps: 0,

          /** Custom period end hour */
          //pe: 23,

          /** Custom period 2 start hour */
          //ps2: 0,

          /** Custom period 2 end hour */
          //pe2: 23,

          /** How many cheapest hours (custom period 2) */
          //c2: 0,

          /** Should the hours be sequential / in a row (custom period 2) [0/1] */
          //s2: 0,
        },

        /** Backup hours [binary] (example: 0b111111 = 00, 01, 02, 03, 04, 05) */
        //b: 0b0,

        /** Relay output command if clock time is not known [0/1] */
        //e: 0,

        /** Outputs IDs to use (array of numbers) */
        //o: [0],

        /** Forced hours [binary] (example: 0b110000000000001100001 = 00, 05, 06, 19, 20) */
        //f: 0b0,

        /** Forced hours commands [binary] (example: 0b110000000000001100000 = 05, 06, 19, 20 are forced to on, 00 to off (if forced as in above example "fh" setting) */
        //fc: 0b0,

        /** Invert output [0/1] */
        //i: 0,

        /** How many first minutes of the hour the output should be on [min]*/
        //m: 60,

        /** Output config - when to set output (0 = always after running logic, 1 = only when output changes)*/
        //oc: 0,

        /** Price resolution (0 = average price of the hour, 1 = price of each 15 minutes, 2 = average price of 30 minutes) */
        //q: 0
      },


      //-------------------------------------
      // Ohjaus #3
      //-------------------------------------
      {
        /** Enabled [0/1]*/
        //en: 0,

        /**  
         * Active mode
         * 0: manual mode (on/off toggle)
         * 1: price limit
         * 2: cheapest hours 
        */
        //mode: 0,

        /** Settings for mode 0 (manual) */
        m0: {
          /** Manual relay output command [0/1] */
          //c: 0
        },

        /** Settings for mode 1 (price limit) */
        m1: {
          /** Price limit limit - if price <= relay output command is set on [c/kWh] */
          //l: 0
        },

        /** Settings for mode 2 (cheapest hours) */
        m2: {
          /** Period length (-1 = custom range) [h] (example: 24 -> cheapest hours during 24h) */
          //p: 24,

          /** How many cheapest hours (can have decimals if price resolution is 30 or 15 minutes, for example 1.5) */
          //c: 0,

          /** Always on price limit [c/kWh] */
          //l: -999,

          /** Should the hours be sequential / in a row [0/1] */
          //s: 0,

          /** Maximum price limit [c/kWh] */
          //m: 999,

          /** Custom period start hour */
          //ps: 0,

          /** Custom period end hour */
          //pe: 23,

          /** Custom period 2 start hour */
          //ps2: 0,

          /** Custom period 2 end hour */
          //pe2: 23,

          /** How many cheapest hours (custom period 2) */
          //c2: 0,

          /** Should the hours be sequential / in a row (custom period 2) [0/1] */
          //s2: 0,
        },

        /** Backup hours [binary] (example: 0b111111 = 00, 01, 02, 03, 04, 05) */
        //b: 0b0,

        /** Relay output command if clock time is not known [0/1] */
        //e: 0,

        /** Outputs IDs to use (array of numbers) */
        //o: [0],

        /** Forced hours [binary] (example: 0b110000000000001100001 = 00, 05, 06, 19, 20) */
        //f: 0b0,

        /** Forced hours commands [binary] (example: 0b110000000000001100000 = 05, 06, 19, 20 are forced to on, 00 to off (if forced as in above example "fh" setting) */
        //fc: 0b0,

        /** Invert output [0/1] */
        //i: 0,

        /** How many first minutes of the hour the output should be on [min]*/
        //m: 60,

        /** Output config - when to set output (0 = always after running logic, 1 = only when output changes)*/
        //oc: 0,

        /** Price resolution (0 = average price of the hour, 1 = price of each 15 minutes, 2 = average price of 30 minutes) */
        //q: 0
      }
    ]
}



//-------------------------------------
// Koodi alkaa, älä koske
//-------------------------------------
function getKvsKey(inst) {
  //v10: version 10 asetukset ovat omissa avaimissaan (versiossa 3.x "porssi" ja "porssi-1"...)
  let key = "porssisahko";

  if (inst >= 0) {
    key = key + "-" + (inst + 1);
  }

  return key;
}

//v10: asetukset ovat KVS:ssä arvojen listana kiinteässä järjestyksessä, ilman asetusten nimiä.
//Listan ensimmäinen arvo on muodon versio. Tekstit kirjoitetaan merkillä ' merkin " sijaan.
//  ohjaus:  [1,en,mode,[m0.c],[m1.l],[m2.p,c,l,s,m,ps,pe,ps2,pe2,c2,s2],b,e,o,f,fc,i,m,oc,q]
//  yleiset: [1,g,vat,day,night,names,cnt,hist,tt,ss,se,ds,de]
//Samat funktiot kuin pääskriptissä.
function pack(inst, c) {
  let m = c.m2;

  return swapQ(JSON.stringify(inst < 0
    ? [1, c.g, c.vat, c.day, c.night, c.names, c.cnt, c.hist, c.tt, c.ss, c.se, c.ds, c.de]
    : [1, c.en, c.mode, [c.m0.c], [c.m1.l], [m.p, m.c, m.l, m.s, m.m, m.ps, m.pe, m.ps2, m.pe2, m.c2, m.s2], c.b, c.e, c.o, c.f, c.fc, c.i, c.m, c.oc, c.q]));
}

function unpack(inst, value) {
  let a = JSON.parse(swapQ(value));

  if (inst < 0) {
    return { g: a[1], vat: a[2], day: a[3], night: a[4], names: a[5], cnt: a[6], hist: a[7], tt: a[8], ss: a[9], se: a[10], ds: a[11], de: a[12] };
  }

  let m = a[5] || [];

  return {
    en: a[1], mode: a[2], m0: { c: (a[3] || [])[0] }, m1: { l: (a[4] || [])[0] },
    m2: { p: m[0], c: m[1], l: m[2], s: m[3], m: m[4], ps: m[5], pe: m[6], ps2: m[7], pe2: m[8], c2: m[9], s2: m[10] },
    b: a[6], e: a[7], o: a[8], f: a[9], fc: a[10], i: a[11], m: a[12], oc: a[13], q: a[14]
  };
}

//Vaihtaa merkit " ja ' keskenään
function swapQ(str) {
  let a = str.split("\"");
  let res = "";

  for (let i = 0; i < a.length; i++) {
    let b = a[i].split("'");

    for (let j = 0; j < b.length; j++) {
      res += (j ? "\"" : "") + b[j];
    }

    if (i < a.length - 1) {
      res += "'";
    }
  }

  return res;
}

function requestReload() {
  let req = {
    //v10: kaikki asetukset ladataan uudelleen (aiemmin &i=0, jolloin ohjausten #2 ja #3 muutokset
    //tulivat voimaan vasta pääskriptin uudelleenkäynnistyksessä)
    url: "http://localhost/script/" + MAIN_SRIPT_NUMBER + "?r=r",
    timeout: 5,
    ssl_ca: "*"
  };

  Shelly.call("HTTP.GET", req, function (res, err, msg) {
    if (!err) {
      console.log("Config changed");
    } else {
      console.log("Error:", err, msg);
    }

    Shelly.call("Script.Stop", { id: Shelly.getCurrentScriptId() }, function () { });
  });
}

//v10: siirtyy seuraavaan ohjaukseen tai pyytää lopuksi pääskriptiä lataamaan asetukset
function next(inst) {
  if (inst < 2) {
    Timer.set(500, false, function () { chkConfig(inst + 1); });
  } else {
    //Done - request porssisahko to reload
    Timer.set(500, false, requestReload);
  }
}

function chkConfig(inst) {
  let key = getKvsKey(inst);

  //Haetaan nykyiset asetukset
  Shelly.call('KVS.Get', { key: key }, function (res, err, msg) {
    //v10: asetuksia ei ole, jos ohjaus ei ole käytössä (ohjausten määrä) tai pääskripti ei ole käynnistynyt kertaakaan
    //Ohjaus ohitetaan - pääskripti luo asetukset, kun ohjaus otetaan käyttöön
    if (!res) {
      console.log("No settings for #" + inst + " (" + key + ") - skipped");
      next(inst);
      return;
    }

    let active = unpack(inst, res.value);
    console.log("Active settings for #" + inst + ": ", JSON.stringify(active));

    //Muutetaan mitä muutetaan
    let source = inst < 0
      ? cfg.c
      : cfg.i[inst];

    //Note: Hard-coded to max 2 levels
    for (let prop in source) {
      //v10: listat (lähdöt ja nimet) korvataan kokonaan - aiemmin ne yhdistettiin alkio kerrallaan,
      //jolloin listaa ei voinut lyhentää (lähdöt [0,1] + [1] -> [1,1])
      if (typeof source[prop] === "object" && source[prop].length === undefined) {
        for (let innerProp in source[prop]) {
          active[prop][innerProp] = source[prop][innerProp];
        }
      } else {
        active[prop] = source[prop];
      }
    }

    //Save the new settings
    Shelly.call("KVS.Set", { key: key, value: pack(inst, active) }, function (res, err, msg) {

      if (err) {
        console.log("Error updating config for #" + inst + ":", err, msg);
        return;
      }

      console.log("Config changed for #" + inst + ":", JSON.stringify(active));
      console.log(" ");

      next(inst);
    });

  });
}

chkConfig(-1);

//-------------------------------------
// HUOM: Asetukset löytyvät ylhäältä
//-------------------------------------