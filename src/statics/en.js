/**
 * shelly-porssisahko
 * 
 * (c) Jussi isotalo - http://jisotalo.fi
 * https://github.com/jisotalo/shelly-porssisahko
 * 
 * License: GNU Affero General Public License v3.0 
 *
 * NOTE: This is a modified version (10.0.0) by @mattik-gh, based on version 3.4.0 of the original project.
 * It is not published or supported by the original author.
 * 
 * v10: English translations of the user interface (common texts, status and history)
 * Texts that are used only in the settings are in en-config.js
 * Key = Finnish text as it is in the code (see t() and tr() in s.js)
 * - "text|context" = translation for one place only
 * - %s = place of a value
 */
TR = {
  //Common
  "Tila": "Status",
  "Historia": "History",
  "Asetukset": "Settings",
  "Ohjaus #%s": "Control #%s",
  "Sivun avaus epäonnistui - kokeile uudelleen? (%s)": "Failed to load the page - try again? (%s)",
  "Ladataan...": "Loading...",

  //Control states
  "Käynnistetään": "Starting...",
  "Käsiohjaus|tila": "Manual mode",
  "Hinta alle rajan": "Price below limit",
  "Hinta yli rajan": "Price over limit",
  "Hinta ei halvimpia tällä ajanjaksolla": "Not among cheapest in this period",
  "Hinta halvimpia tällä ajanjaksolla": "Among cheapest in this period",
  "Hinta alle aina päällä -rajan": "Price below always on limit",
  "Varmuustuntiohjaus (ei hintoja, aika tiedossa)": "Backup control (no prices, time known)",
  "Hätätilaohjaus (aika ei tiedossa)": "Emergency control (time unknown)",
  "Pakko-ohjaus (%s asti)": "Manual override (until %s)",
  "Pakko-ohjattu tunti": "Override hour",
  "Hinta yli maksimirajan": "Price over max. limit",
  "Käyttäjän skriptiohjaus ylikirjoittaa": "User script overwriting",
  "Tunnin ohjausminuutit käytetty": "Control minutes of this hour already used",

  //Control modes
  "Käsiohjaus": "Manual",
  "Hintaraja": "Price limit",
  "Jakson halvimmat tunnit": "Cheapest hours",

  //Status
  "Laite ja ohjaus": "Device and control",
  "Ohjaus nyt": "Output now",
  "Ohjauksen selite": "Description",
  "Sähkön hinta nyt": "Price now",
  "Ohjaustyyppi": "Mode",
  "Tila|rivi": "State",
  "Tänään": "Today",
  "Huomenna": "Tomorrow",
  "Energia": "Energy",
  "Siirto": "Transfer",
  "Ohjaus päällä": "Output on",
  "**pakko-ohjaus": "**manual override",
  "Taustaväri vaihtuu jakson vaihtuessa.": "Background color changes when the period changes.",
  "PÄÄLLÄ": "ON",
  "POIS": "OFF",
  "(käänteinen)": "(inverted)",
  "lähtöä %s ei löydy laitteesta": "output %s not found in the device",
  "Lähtöä %s ei ole tässä laitteessa. Tarkista ohjattavat lähdöt asetuksista.": "This device has no output %s. Check the outputs in the settings.",
  "lähtöä ei ole määritetty": "no output defined",
  "Ohjaus ei kytke mitään lähtöä. Määritä lähtö asetuksissa.": "No output to switch. Define the output in the settings.",
  "Ohjaus tarkistettu %s": "Output checked at %s",
  "Tarkistetaan ohjausta...": "Checking output...",
  "Ei käytössä": "Not enabled",
  "Ohjaus #%s ei ole käytössä": "Control #%s isn't enabled",
  "ohjaus #%s": "control #%s",
  "Hinnat päivitetty %s": "Prices updated at %s",
  "Hintoja haetaan...": "Getting prices...",
  "Käynnistetty %s, <span>käynnissä %s päivää.</span>": "Started at %s, <span>uptime %s days.</span>",
  "Muistia käytössä %s kt, suurin käyttö %s kt <span>(käytettävissä %s kt).</span>": "Memory in use %s kB, peak %s kB <span>(available %s kB).</span>",
  "Versio %s (%s), <span>perustuu versioon 3.4.0 (%s)</span>": "Version %s (%s), <span>based on version 3.4.0 (%s)</span>",
  "Keskihinta": "Average",
  "Halvin": "Lowest",
  "Kallein": "Highest",
  "Ohjauksen keskihinta": "Average when on",
  "Aika": "Time",
  "Hinta": "Price",
  "Ohjaus|sarake": "Output",
  "Ei vielä tiedossa": "Not yet known",
  "Tila ei tiedossa (%s)": "Status unknown (%s)",
  "%s - ohjaus päällä&#10;%s c/kWh (energia %s + siirto %s)": "%s - output on&#10;%s c/kWh (energy %s + transfer %s)",
  "%s - ohjaus pois&#10;%s c/kWh (energia %s + siirto %s)": "%s - output off&#10;%s c/kWh (energy %s + transfer %s)",
  "Ohjaus päällä %s - %s (%s)": "Output on %s - %s (%s)",
  "Jakso %s - %s": "Period %s - %s",

  //History
  "Ohjaus": "Output",
  "Selite": "Description",
  "Ei historiaa": "No history",
  "Ohjaus päälle": "Output ON",
  "Ohjaus pois": "Output OFF",
  "Hintahaun virheitä käynnistyksen jälkeen: %s": "Price request errors since start: %s",
  "(ensimmäinen %s)": "(first %s)",
  "Viimeisin katko: %s – %s": "Latest outage: %s – %s",
  "1 virhe": "1 error",
  "%s virhettä": "%s errors"
};
