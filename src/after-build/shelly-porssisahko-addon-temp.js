//__REPLACED_WITH_MAIN_CODE__

/**
 * Tämä käyttäjäskripti ylikirjoittaa 1. ohjauksen lähdön tarvittaessa
 * Shelly Plus Add-onin mittaaman lämpötilan perusteella.
 *
 * Idea on, että jos lämpötila on tarpeeksi korkea, ei ohjata turhaan.
 * Ja jos lämpötila onkin liian matala, ohjataan vaikka olisi kallista.
 *
 * Muuten mennään pörssiohjauksen mukaan.
 *
 * v10: lämpötilan muutokseen reagoidaan noin 10 sekunnissa (aiemmin vasta, kun ohjaus tarkistettiin
 * seuraavan kerran, eli tuntitarkkuudella kerran tunnissa). Rajoille on hystereesi, jotta lähtö ei
 * kytkeydy edestakaisin, kun lämpötila on lähellä rajaa. Alkuperäinen projekti, issue #39.
 */

//------------------------------
// Asetukset - muokkaa haluamaksesi
//------------------------------

//Lämpötila-anturin numero (Add-onin anturit ovat 100-104, ensimmäinen yleensä 100)
//v10: uusi. Numeron näkee Shellyn hallinnasta anturin kohdalta, jos antureita on useampi
let TEMP_SENSOR = 100;

//Yläraja (°C): kun lämpötila on yli tämän, ohjaus pois (vaikka pörssiohjaus olisi päällä)
let TEMP_HIGH = 15;

//Alaraja (°C): kun lämpötila on alle tämän, ohjaus päälle (vaikka pörssiohjaus olisi pois)
let TEMP_LOW = 5;

//Hystereesi (°C): ylärajan ohitus päättyy vasta, kun lämpötila on laskenut arvoon (TEMP_HIGH - TEMP_HYST),
//ja alarajan ohitus vasta, kun lämpötila on noussut arvoon (TEMP_LOW + TEMP_HYST). 0 = ei hystereesiä
//HUOM: jos arvo on 0 tai hyvin pieni (alle anturin lukeman vaihtelun, esim. 0.1), lähtö voi kytkeytyä
//edestakaisin ("rämpyttää"), kun lämpötila on rajan kohdalla. Silloin kytkentöjä rajoittaa vain TEMP_MIN_INTERVAL
let TEMP_HYST = 0.5;

//Reagoidaanko lämpötilan muutokseen heti (noin 10 s kuluessa)
//false = lämpötila otetaan huomioon vain, kun ohjaus muutenkin tarkistetaan (kuten ennen versiota 10)
let TEMP_REACT = true;

//Lyhin aika (minuuttia) kahden lämpötilan muutoksesta johtuvan tarkistuksen välillä
//Rajoittaa kytkentöjä, jos lämpötila vaihtelee nopeasti. Tavallisiin tarkistuksiin tämä ei vaikuta
let TEMP_MIN_INTERVAL = 5;

//------------------------------
// Asetukset päättyvät
//------------------------------

//Hystereesin tila: 1 = ylärajan ohitus voimassa, -1 = alarajan ohitus voimassa, 0 = ei ohitusta
let tempZone = 0;

//Hystereesin tila, jolla ohjaus viimeksi tarkistettiin (null = ei vielä tarkistettu tai lukemaa ei ollut)
let tempZoneUsed = null;

//Laitteen käyntiaika (s), jolloin tarkistusta viimeksi pyydettiin lämpötilan takia (-1 = ei vielä)
let tempReqUptime = -1;

/**
 * Päivittää hystereesin tilan lämpötilan perusteella ja palauttaa sen (1, -1 tai 0)
 * Ensimmäisellä lukemalla tila vastaa rajoja ilman hystereesiä
 */
function updateTempZone(tC) {
  if (tC > TEMP_HIGH) {
    tempZone = 1;
  } else if (tC < TEMP_LOW) {
    tempZone = -1;
  } else if (tempZone == 1 && tC <= TEMP_HIGH - TEMP_HYST) {
    tempZone = 0;
  } else if (tempZone == -1 && tC >= TEMP_LOW + TEMP_HYST) {
    tempZone = 0;
  }
  return tempZone;
}

function USER_OVERRIDE(inst, cmd, callback) {
  //Otetaan tila talteen
  const state = _;

  //Jos kyseessä on joku muu ohjaus kuin #1 niin ei tehdä mitään
  if (inst != 0) {
    callback(cmd);
    return;
  }

  try {
    //Jos lukemaa ei saada, seuraava kelvollinen lukema tarkistaa ohjauksen uudelleen (ks. USER_LOOP)
    tempZoneUsed = null;

    //console.log("Suoritetaan USER_OVERRIDE. Ohjauksen tila ennen: ", cmd);
    let temp = Shelly.getComponentStatus("temperature:" + TEMP_SENSOR);

    if (!temp) {
      state.si[inst].str = "Lämpötilaohjauksen virhe - anturia " + TEMP_SENSOR + " ei löytynyt";
      throw new Error("Lämpötila-anturia " + TEMP_SENSOR + " ei löytynyt");
    }

    if (temp.tC == null) {
      state.si[inst].str = "Lämpötilaohjauksen virhe - onko anturi kytketty?";
      throw new Error("Onko anturi kytketty?");
    }

    let zone = updateTempZone(temp.tC);
    tempZoneUsed = zone;

    if (cmd && zone == 1) {
      state.si[inst].str = "Lämpötila " + temp.tC + "°C " + (temp.tC > TEMP_HIGH ? "on yli " + TEMP_HIGH + "°C" : "ei ole vielä laskenut " + (TEMP_HIGH - TEMP_HYST) + " asteeseen") + " -> ohjaus pois";
      console.log("Lämpötila on yli ylärajan, asetetaan ohjaus pois. Lämpötila nyt:", temp.tC);
      cmd = false;

    } else if (!cmd && zone == -1) {
      state.si[inst].str = "Lämpötila " + temp.tC + "°C " + (temp.tC < TEMP_LOW ? "on alle " + TEMP_LOW + "°C" : "ei ole vielä noussut " + (TEMP_LOW + TEMP_HYST) + " asteeseen") + " -> ohjaus päälle";
      console.log("Lämpötila on alle alarajan, asetetaan ohjaus päälle. Lämpötila nyt:", temp.tC);
      cmd = true;

    } else {
      state.si[inst].str = "Lämpötila " + temp.tC + "°C -> mennään ohjauksen mukaan";
    }

    //console.log("USER_OVERRIDE suoritettu. Ohjauksen tila nyt: ", cmd);
    callback(cmd);

  } catch (err) {
    console.log("Virhe tapahtui USER_OVERRIDE-funktiossa. Virhe:", err);
    state.si[inst].str = "Lämpötilaohjauksen virhe:" + err;
    callback(cmd);
  }
}

/**
 * v10: pääskripti kutsuu tätä noin 10 sekunnin välein, kun sillä ei ole muuta tehtävää
 * Jos hystereesin tila on muuttunut ohjauksen edellisestä tarkistuksesta, pyydetään uusi tarkistus.
 * Pääskripti tekee sen seuraavalla kierroksella (USER_OVERRIDE ratkaisee lähdön tilan)
 */
function USER_LOOP() {
  //Pääskriptin silmukka vapautetaan heti: tämä funktio ei tee mitään, mikä jäisi odottamaan
  //(näin silmukka ei jää varatuksi, vaikka alla tapahtuisi virhe)
  loopRunning = false;

  try {
    if (!TEMP_REACT || _.c.i[0].en != 1) {
      return;
    }

    let temp = Shelly.getComponentStatus("temperature:" + TEMP_SENSOR);

    //Puuttuva lukema ei muuta mitään (anturi voi katkeilla)
    if (!temp || temp.tC == null) {
      return;
    }

    let zone = updateTempZone(temp.tC);

    if (zone === tempZoneUsed) {
      return;
    }

    //Käyntiaika ei muutu kellon siirtyessä, joten aikaväli pysyy oikeana
    let up = (Shelly.getComponentStatus("sys") || {}).uptime;

    if (typeof up !== "number") {
      return;
    }

    if (tempReqUptime >= 0 && up - tempReqUptime < TEMP_MIN_INTERVAL * 60) {
      return;
    }

    tempReqUptime = up;
    console.log("Lämpötila " + temp.tC + "°C, rajan ohitus muuttui -> tarkistetaan ohjaus #1");
    _.si[0].chkTs = 0;

  } catch (err) {
    console.log("Virhe tapahtui USER_LOOP-funktiossa. Virhe:", err);
  }
}
