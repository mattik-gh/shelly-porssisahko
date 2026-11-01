# Testaus

Skriptiä testataan kolmella tasolla. Jokainen taso näkee eri asioita, ja ne täydentävät toisiaan.

| Taso | Mitä ajetaan | Mitä se löytää | Mitä se ei näe |
| --- | --- | --- | --- |
| **Koko skripti, simulaattori** | pääskripti (ja lisäosat) Node.js:ssä simuloiduilla Shelly-rajapinnoilla | virheet ohjauslogiikassa, hintojen käsittelyssä, käyttöliittymässä ja vikatilanteissa | laitteen muistin, tulkin erot, oikean verkon |
| **Lisäosa, simulaattori** | lisäosan koodi ilman pääskriptiä | virheet lisäosan omassa logiikassa | pääskriptin muutosten vaikutuksen lisäosaan |
| **Koko skripti, laite** | valmis skripti oikeassa Shellyssä | muistin, tulkin erot (esim. Gen 2:n kutsupino), oikeat releet ja oikean hintahaun | tilanteet, jotka vaativat simuloituja hintoja tai vikojen syöttöä |

Vaatimukset: Node.js 20 tai uudempi. Testit eivät tarvitse lisäkirjastoja.

## Komennot

| Komento | Mitä ajaa |
| --- | --- |
| `npm test` | kaikki simulaattoritestit ja lisäosien testit kahdesti: lähdekoodia ja koontiversiota vastaan (ei laitetestiä). Tee koontiversio ensin (`npm run build`) |
| `npm run test:src` | testit vain lähdekoodia vastaan |
| `npm run test:dist` | testit vain koontiversiota vastaan, ks. [Simulaattori](#simulaattori) |
| `npm run test:addons` | lisäosien testit: yksin ja pääskriptin kanssa |
| `npm run test:addons:alone` | lisäosat vain yksin |
| `node --test test/addons/open-meteo-api.test.js` | yhden lisäosan testit |
| `node --test test/logic.test.js` | yksi testitiedosto |
| `node --test --test-name-pattern="hintaraja"` | testit, joiden nimessä on annettu teksti |
| `npm run test:device -- <osoite>` | laitetesti, ks. [Laitetesti](#laitetesti) |

Skriptin lokin saa näkyviin asettamalla ympäristömuuttujan `SIM_LOG=1`.

## Testien määrä ja kesto

Simulaattoritestejä on 899. `npm test` ajaa ne kahdesti, lähdekoodia ja koontiversiota vastaan, ja kumpikin ajo kestää muutaman sekunnin.

| Kokonaisuus | Testejä |
| --- | --- |
| Asetussivu | 149 |
| Käyttöliittymän tiedostot (lataus, pakkaus, otsakkeet) | 11 |
| Tilasivun ennuste ja hintakaavio | 85 |
| Kaksikielisyys | 24 |
| Ohjauslogiikka | 105 |
| Lisäosat | 100 |
| Korjatut viat | 81 |
| Hintojen haku ja jäsennys | 84 |
| 15 ja 30 minuutin ohjaus | 44 |
| Kellonsiirtopäivät ja testirajapinta | 68 |
| HTTP-rajapinta (tila, asetukset, pakko-ohjaus, virhetilanteet) | 55 |
| Ohjausten määrä | 25 |
| Muuttujien näkyvyys vanhoissa laiteohjelmistoissa | 23 |
| Muut (asetusskripti, muistiarvio, historiasivu, lisäosarajapinta, purkuesimerkit) | 45 |

Laitetesti tekee oikealla laitteella noin 70-80 tarkistusta ja kestää noin 10 minuuttia kellotesteineen. Jokainen lisäosaversio ajetaan erikseen, ja yksi ajo kestää ilman kellotestejä noin 7 minuuttia.

## Tiedostot

| Tiedosto | Sisältö |
| --- | --- |
| `sim/shelly-sim.js` | Simulaattori: `Shelly.call`, `Timer`, `HTTPServer`, KVS, lähdöt, kello |
| `sim/elering.js` | Elering-rajapinnan CSV-vastausten muodostus |
| `sim/addon-alone.js` | Lisäosan ajaminen yksin ilman pääskriptiä |
| `helpers.js` | Testien apufunktiot (`boot`, `runDay`, `runDaySlots`, ...) |
| `fixtures/` | Oikeita Elering-vastauksia: tavallinen päivä ja kellonsiirtopäivät |
| `logic.test.js` | Ohjauslogiikka: ohjaustavat, rajat, pakko-ohjaukset, vikatilanteet, historia |
| `prices.test.js` | Hintojen haun ajoitus, jäsennys, virheellinen data ja katkot |
| `quarter.test.js`, `half.test.js` | Ohjaus 15 ja 30 minuutin hinnoilla, tuntimäärä desimaaleina |
| `dst-periods.test.js` | Jaksojen rajat kellonsiirtopäivinä, ja skriptin päivämäärien aikavyöhyke kuten laitteella (mitattu) |
| `instances.test.js` | Ohjausten määrän muuttaminen ajon aikana |
| `http.test.js` | Skriptin HTTP-rajapinta, staattiset tiedostot, asetusten tallennus |
| `settings-api.test.js` | Asetusten muuttaminen HTTP-pyynnöllä (`r=w`) |
| `ui-parity.test.js` | Tilasivun ohjausennuste ja hintakaavio verrattuna laitteen todelliseen ohjaukseen |
| `ui-config.test.js` | Asetussivu: syöttömaskit, pyöristys, lähtökentän tarkistus, varoitukset |
| `ui-history.test.js` | Historiasivu: historian purku ja hintahaun virhetilasto |
| `i18n.test.js` | Kaksikielinen käyttöliittymä: jokaisella tekstillä on englanninkielinen käännös, käännöstiedostossa ei ole käyttämättömiä rivejä, käännösfunktiot |
| `user-scripts.test.js` | Lisäosarajapinta `USER_CONFIG`, `USER_OVERRIDE`, `USER_LOOP` |
| `addons/*.test.js` | Mukana tulevat lisäosat, yksi tiedosto per lisäosa |
| `config-script.test.js` | Erillinen asetusskripti pääskriptin rinnalla |
| `known-issues.test.js` | Korjatut viat: jokaiselle testi, joka estää vian paluun |
| `memory.test.js` | Muistin käytön arvio verrattuna laitteelta mitattuun budjettiin |
| `unpack-doc.test.js` | `docs/unpack.md`: ulkoisen ohjelman purkufunktiot luetaan dokumentista ja verrataan skriptin omaan hintalaskentaan ja historiaan |
| `build-scope.test.js` | Muuttujien näkyvyys: koodi toimii myös laiteohjelmistoissa, joissa `let` ja `const` toimivat kuin `var` (esim. Gen 2:n 1.3.2) |
| `run-dist.js` | Ajaa testisarjan koontiversiota vastaan (osa `npm test` -komentoa) |
| `serve.js` | Simulaattori selaimessa käytettäväksi |
| `device/run.js` | Laitetesti |
| `device/fake-elering.js` | Kellonsiirtotestien testirajapinta laitteelle (`--dst`), ei julkaista |
| `fake-elering.test.js` | Testirajapinnan vastaukset verrattuna Elering-malliin, ja julkaistavan skriptin hakuosoite |

## Simulaattori

Simulaattori lataa tiedoston `src/shelly-porssisahko.js` (tai jonkin `src/after-build/`-version) sellaisenaan ja antaa sille simuloidut Shelly-rajapinnat, ohjattavan kellon ja Elering-vastaukset.

Toinen ajo (`run-dist.js`) lataa pääskriptin tilalle koontiversion `dist/shelly-porssisahko.js` (ympäristömuuttuja `SIM_MAIN`). Laitteelle menee juuri tämä minimoitu versio, jossa `let` ja `const` on muutettu `var`-muotoon, joten ajo varmistaa, että minimointi ei muuta toimintaa. Sivutiedostoja verrataan silloin minimoituihin tiedostoihin (`dist/statics/*.nozip.*`). Ajo pysähtyy heti, jos koontiversio on vanhempi kuin lähdekoodi.

- **Kello ei etene itsestään.** Testi siirtää aikaa, ja simulaattori ajaa ajastimet ja RPC-vastaukset aikajärjestyksessä. Vuorokauden ajo kestää millisekunteja ja tulos on aina sama.
- **Kello käyttäytyy kuten laitteessa:** kaikille päivämäärille käytetään samaa, sen hetkistä aikavyöhyke-eroa. Kesäaikasääntöjä ei ole.
- **Hinnat** muodostetaan testin antamasta hintafunktiosta tai luetaan oikeista tallenteista.
- **Viat syötetään testistä:** verkkovirhe, aikakatkaisu, virhekoodi, virhesivu, puuttuva kellonaika, epäonnistuva tai olematon lähtö.
- **Rajat:** simulaattori valvoo laitteen rajoja 5 ajastinta ja 5 yhtäaikaista RPC-kutsua. Käsittelemätön virhe takaisinkutsussa pysäyttää simuloidun skriptin kuten laitteessa.

### Testin kirjoittaminen

```js
const { boot, runDay, hours } = require('./helpers');

test('4 halvinta tuntia', () => {
  const sim = boot({ start: '2026-10-05T23:50:00', inst: { mode: 2, m2: { p: 24, c: 4 } } });
  assert.deepEqual(runDay(sim, '2026-10-06'), hours([1, 2, 3, 4]));
});
```

- `sim.advance(ms)`, `sim.advanceTo(aika)` ja `sim.settle()` siirtävät kelloa.
- `sim.status(inst)` palauttaa saman tilan kuin käyttöliittymän `?r=s` (hinnat purettuina).
- `sim.rows(päivä)` palauttaa tuntihinnat ALV ja siirtomaksu mukana, `sim.slotRows(päivä)` jokaisen 15 minuutin jakson.
- `sim.relays` kertoo lähtöjen tilan ja `sim.history(inst)` historian.
- `sim.saveConfig(inst, asetukset, yleiset)` tallentaa asetukset kuten käyttöliittymä.
- `sim.evaluate("_.s.errCnt")` lukee skriptin sisäistä tilaa.
- Vikoja syötetään kentillä `sim.net.mode`, `sim.net.res`, `sim.switchFail` ja `sim.timeSynced`.
- `sim.runScript(koodi)` ajaa toisen, erillisen skriptin samassa laitteessa (esim. asetusskripti).

### Testit toista pääskriptiä vasten

Testit voi ajaa myös toista pääskriptiä vasten, esimerkiksi valmista buildia tai vanhaa versiota:

```bash
SIM_MAIN=$PWD/dist/shelly-porssisahko.js npm test
```

Staattisten tiedostojen testit epäonnistuvat silloin odotetusti, koska build minimoi tiedostot.

### Simulaattori selaimessa

Skriptin voi ajaa simulaattorissa ja käyttää sen käyttöliittymää selaimella ilman laitetta.

**Simulaattorin käynnistys**

```bash
node test/serve.js --port 8080 --speed 60 --start 2026-10-05T14:00:00
```

| Valinta | Selite |
| --- | --- |
| `--port` | Portti, jossa käyttöliittymä näkyy (oletus 8080) |
| `--speed` | Kellon nopeus: 1 = oikea aika (oletus), 60 = minuutti sekunnissa |
| `--start` | Simulaattorin kellonaika käynnistyessä |
| `--script` | Ajettava skripti, esimerkiksi lisäosaversio `shelly-porssisahko-addon-temp.js` (oletus pääskripti) |

**Käyttöliittymän avaaminen**

Avaa selaimessa `http://127.0.0.1:8080/script/1` (ei `localhost`, koska käyttöliittymä siirtyy silloin kehitystilaan).

**Simulaattorin ohjaus**

Simulaattoria ohjataan ajon aikana osoitteella `/sim`:

| Pyyntö | Vaikutus |
| --- | --- |
| `/sim` | Tila: kello, lähdöt, KVS, viimeisimmät lokirivit |
| `/sim?advance=3600` | Siirtää kelloa eteenpäin (sekunteja) |
| `/sim?time=2026-10-25T02:59:00` | Hyppäyttää kellon |
| `/sim?speed=60` | Kellon nopeus (0 = pysäytetty) |
| `/sim?net=error` | Elering: `ok`, `error`, `timeout` tai HTTP-statuskoodi |
| `/sim?synced=0` | Kellonaika ei tiedossa |
| `/sim?switchfail=1` | Lähtöjen ohjaus epäonnistuu |
| `/sim?temp=-12` | Lämpötila-anturin `temperature:100` arvo |

## Lisäosien testaus

Jokaisella mukana tulevalla lisäosalla on oma tiedostonsa hakemistossa `test/addons/`, ja tiedostossa on kaksi osaa.

### Lisäosa yksin

`sim/addon-alone.js` lataa lisäosan ilman pääskriptiä ja antaa sille pelkistetyn version siitä, mitä lisäosa pääskriptiltä käyttää: tilan (`_`), anturikyselyn, verkkokutsun, HTTP-päätepisteen ja kellon. Testi kutsuu lisäosan funktioita suoraan.

```js
const { loadAddon } = require('../sim/addon-alone');

test('-12 °C -> 7 tuntia', () => {
  const addon = loadAddon('shelly-porssisahko-addon-temp-hours.js', {
    components: { 'temperature:100': { tC: -12 } },
    config: [{ m2: { c: 2 } }]
  });

  addon.config(0, true);                          // pääskripti on lukenut asetukset
  assert.equal(addon.config(0, false).m2.c, 7);   // ennen logiikan ajoa
});
```

| Kutsu | Vastaa pääskriptin toimintaa |
| --- | --- |
| `addon.config(inst, true)` | `USER_CONFIG`, kun asetukset on luettu |
| `addon.config(inst, false)` | `USER_CONFIG` juuri ennen logiikan ajoa |
| `addon.override(inst, cmd)` | `USER_OVERRIDE` logiikan lopuksi. Palauttaa `{ count, value }`: montako kertaa lisäosa vastasi ja millä arvolla (`null` = aja logiikka uudelleen) |
| `addon.respond(vastaus, virhe, viesti)` | vastaa lisäosan tekemään `Shelly.call`-kutsuun (esim. sääennusteen haku) |
| `addon.request(parametrit, päätepiste)` | HTTP-pyyntö lisäosan rekisteröimään osoitteeseen |
| `addon.advance(ms)` | siirtää kelloa |
| `addon.state`, `addon.components`, `addon.calls`, `addon.logs` | tila, anturit, odottavat kutsut ja lokirivit |

Yksin ajettu testi kertoo heti, onko vika lisäosassa, eikä vaadi pääskriptin asetuksia tai hintoja. **Rajoitus:** pelkistetty pääskripti ei päivity itsestään. Jos pääskriptin rakenne muuttuu, yksin ajettu testi menee yhä läpi, vaikka lisäosa olisi oikeasti rikki. Siksi lisäosat testataan aina myös pääskriptin kanssa.

### Lisäosa pääskriptin kanssa

Sama simulaattori kuin muissa testeissä, mutta ladattuna on lisäosaversio:

```js
const sim = boot({
  script: 'shelly-porssisahko-addon-temp-hours.js',
  inst: { mode: 2, m2: { p: 24, c: 2 } },
  components: { 'temperature:100': { tC: -12 } }
});
```

Sääpalvelun vastaus annetaan kentällä `sim.net.other`, ja H&T:n lähettämä lämpötila pyynnöllä `sim.request('temp=-7.5', 'update-temp')`.

### Oman lisäosan testaaminen

1. Tee lisäosa hakemistoon `src/after-build/`. Tiedoston alkuun tulee rivi `//__REPLACED_WITH_MAIN_CODE__`, jonka tilalle build liittää pääskriptin.
2. Kopioi jokin tiedosto hakemistosta `test/addons/` pohjaksi ja vaihda tiedoston nimi muuttujaan `script`.
3. Kirjoita ensin osa "yksin": lisäosan oma logiikka rajatapauksineen ja virhetilanteet.
4. Kirjoita sitten osa "pääskriptin kanssa": vähintään yksi testi, jossa lisäosa todella muuttaa ohjausta.
5. Aja `node --test test/addons/<nimi>.test.js`.

## Laitetesti

Laitetesti lataa valmiin skriptin oikeaan Shellyyn ja tarkistaa perustoiminnot. Se löytää asiat, joita simulaattori ei voi nähdä.

> **Vain kehityslaitteelle, jossa ei ole kuormaa.** Testi kytkee releitä päälle ja pois, korvaa laitteen pörssisähköskriptin ja kirjoittaa sen asetuksia.

```bash
npm run build
node test/device/run.js 192.168.1.50
```

Testi näyttää aluksi laitteen tiedot ja listan siitä, mitä se laitteelle tekee, ja pyytää kirjoittamaan **KYLLÄ**. Ilman vahvistusta testiä ei ajeta. Jos päätettä ei ole (esim. automaattinen ajo), testi pysähtyy, ellei valintaa `--yes` ole annettu.

| Valinta | Vaikutus |
| --- | --- |
| `--file <polku>` | ladattava skripti (oletus `dist/shelly-porssisahko.js`) |
| `--clock` | ajaa lisäksi kellotestit, jotka siirtävät laitteen kelloa |
| `--clock-only` | ajaa vain käynnistyksen ja kellotestit |
| `--addon <nimi>` | testaa lisäosaversion: `addon-temp`, `addon-temp-hours`, `ht-sensor-temp`, `open-meteo-api` tai `1-instance-no-history` |
| `--fresh` | uusi asennus: poistaa ensin pörssisähkön skriptin ja kaikki asetukset (myös version 3.x) ja tarkistaa, että tyhjään laitteeseen luodaan oletusasetukset |
| `--dst` | kellonsiirtotestit testirajapinnalla (ks. [Kellonsiirrot testirajapinnalla](#kellonsiirrot-testirajapinnalla)). Ei yhdessä muiden testivalintojen kanssa |
| `--upgrade` | päivitys: asentaa ensin alkuperäisen version 3.4.0 (`fixtures/shelly-porssisahko-3.4.0.js`) ja sille asetukset, päivittää version 10 ja tarkistaa asetusten siirron. Ei yhdessä valinnan `--addon` kanssa |
| `--yes` | ei kysy vahvistusta |

Jokaisella laitteella ja jokaisella laiteohjelmistoversiolla ajetaan sekä uusi asennus (`--fresh`) että päivitys (`--upgrade`), ja lisäksi kaikki lisäosaversiot.

### Mitä testi tarkistaa

| Osa | Sisältö |
| --- | --- |
| Lataus ja käynnistys | skripti käynnistyy, hinnat haetaan, skriptimuistin koko ja muistihuippu. Lisäksi oletus, että skriptin `Date` käyttää kaikille päivämäärille nykyistä aikavyöhykkeen poikkeamaa (laite itse noudattaa kesäaikaa oikein). Jos laiteohjelmisto muuttaa tätä, tarkistus epäonnistuu ja kertoo, mitä koodista pitää tarkistaa |
| Rajapinta ja sivut | kaikki käyttöliittymän tiedostot, tilan muoto, virhetilanteet |
| Asetukset | tallennus ja lataus hintojen ollessa muistissa, ohjausten määrä, rikkinäinen JSON, väärät tyypit, jakson pituus 0 |
| Releet | käsiohjaus, käänteinen ohjaus, usea lähtö ja usea ohjaus, olematon lähtö, lähdön ohjaustapa, pakko-ohjaus, historia, tyhjä lähtölista |
| Oikeat hinnat | hintaraja, ja seitsemällä eri asetuksella laitteen ohjaus verrattuna tilasivun laskemaan suunnitelmaan |
| Kello (`--clock`) | vuorokauden vaihde, 15 minuutin jakson vaihtuminen, paluu nykyhetkeen |
| Kellonsiirrot (`--dst`) | seuraavat kaksi kellonsiirtoa: huomisen hinnat, keskiyön vaihto, varmistushaku, logiikan ajo siirron jälkeen. Hinnat ja ohjaus verrataan simulaattoriin samoilla asetuksilla, ja ohjaus tilasivun suunnitelmaan |
| Lisäosa (`--addon`) | lisäosakohtaiset tarkistukset ilman lähtöjä |
| Uusi asennus (`--fresh`) | yksi ohjaus, oletusasetukset, vain yleiset asetukset ja ohjaus #1 tallennetaan, version 3.x avaimiin ei kirjoiteta |
| Päivitys (`--upgrade`) | versio 3.4.0 käynnistyy ja käyttää asetuksia (kolme ohjausta, kaikki ohjaustavat, omat jaksot, varmuus- ja pakko-ohjaustunnit, hintarajat, ääkköset nimissä). Versio 10: kaikki asetukset siirtyvät, uudet asetukset saavat oletusarvot, asetukset tallennetaan uusiin avaimiin, ohjaus toimii, muutos tallentuu uuteen avaimeen ja version 3.x avaimet jäävät ennalleen |

Testi mukautuu laitteen lähtöjen määrään: usean lähdön laitteella ajetaan lisäksi testit, joissa yksi ohjaus ohjaa kaikkia lähtöjä ja jokaisella ohjauksella on oma lähtönsä.

### Mitä laitteelle jää

- Asetukset ja releiden tila palautetaan testiä edeltäneiksi. Valinnoilla `--fresh` ja `--upgrade` palautetaan myös version 3.x asetukset, ja skripti pysäytetään palautuksen ajaksi, jotta se ei kirjoita muistissa olevia asetuksia takaisin.
- Laitteeseen jää testattu skripti. Lisäosatestin jälkeen tilalle ladataan tavallinen skripti.
- Kellotestien jälkeen kello palautetaan ja skripti käynnistetään uudelleen, jotta historiaan ei jää rivejä väärällä päivämäärällä.
- Kellonsiirtotestien (`--dst`) jälkeen testirajapinta poistetaan, kello palautetaan ja tilalle ladataan tavallinen skripti.
- Laitteen muihin skripteihin ei kosketa.

### Kellotestien rajoitukset

- Shellyn kelloa voi siirtää vain eteenpäin laitteen käynnistyshetkestä, joten testit siirtyvät tulevaan aikaan ja palaavat lopuksi nykyhetkeen.
- Vuorokauden vaihde voidaan testata vain kello 15:n jälkeen, kun huomisen hinnat on julkaistu. Aiemmin ajettuna testi ohittaa sen kohdan ja kertoo syyn.
- Eleringillä ei ole hintoja tuleville kellonsiirtopäiville. Siksi kellonsiirrot testataan laitteella testirajapinnalla (`--dst`), ks. alla.
- Jos laite synkronoi kellonsa kesken testin, kyseinen tarkistus epäonnistuu. Aja testi silloin uudelleen.
- Vanhoissa laiteohjelmistoissa (esim. Gen 2:n 1.3.2) ei ole kellon asetusta (`Sys.SetTime`), joten kellotestit ajetaan niillä vasta laiteohjelmiston päivityksen jälkeen.

### Kellonsiirrot testirajapinnalla

Valinta `--dst` asentaa laitteeseen toiseksi skriptiksi testirajapinnan `device/fake-elering.js` (laitteella nimellä `elering-testirajapinta`). Se jäljittelee Eleringin rajapintaa laitteen sisällä ja vastaa Eleringin CSV-muodossa tuntihinnoilla mille tahansa päivälle. Pääskriptistä ladataan kopio, jossa vain hakuosoite on vaihdettu testirajapintaan (`http://localhost/script/<numero>/prices`). Julkaistava tiedosto ei muutu, ja `fake-elering.test.js` varmistaa, että koontiversiossa on Eleringin osoite.

- Testirajapinta laskee Suomen, Viron, Latvian ja Liettuan (sama) ajan itse EU:n kesäaikasäännöllä, koska laite laskee kaikki päivämäärät nykyisellä poikkeamalla eikä tiedä tulevasta kellonsiirrosta.
- Simulaattorissa testirajapinnan vastaus on merkki merkiltä sama kuin Elering-mallin (`sim/elering.js`), myös kellonsiirtopäivinä, ja pääskripti ohjaa sen hinnoilla samoin.
- Laitteella kello siirretään seuraavien kahden kellonsiirron edelliseen iltaan ja siirron yli. Laitteen hintoja ja ohjausta verrataan simulaattoriin, joka ajaa saman skenaarion samoilla asetuksilla.
- Testi olettaa laitteen ja testikoneen aikavyöhykkeeksi Suomen, Viron, Latvian tai Liettuan ajan ja kertoo, jos niin ei ole.

### Hintahaut

Jokainen skriptin käynnistys hakee hinnat Eleringistä (yksi tai kaksi hakua). Laitetesti käynnistää skriptin muutaman kerran, joten älä aja sitä toistuvasti peräkkäin ilman syytä. Kellonsiirtotestit (`--dst`) hakevat hinnat laitteen sisäisestä testirajapinnasta, joka jäljittelee Eleringin rajapintaa, ja Eleringiltä haetaan vain lopuksi, kun tavallinen skripti palautetaan.

Kellotestin keskiyö tarkistaa myös, että varmistushaku odottaa laitekohtaisen viiveen (3-5 min eli 180-300 s, lasketaan laitteen MAC-osoitteesta samalla kaavalla kuin skriptissä) ja tehdään sen jälkeen.

## Mitä kukin taso ei kata

- **Muisti ja kutsupino:** laitteen 25 kilotavun muistiraja ja pinon syvyys eivät toistu Node.js:ssä. `memory.test.js` antaa arvion tietoerien koosta, mutta todellinen huippu luetaan laitteelta (`Script.GetStatus` -> `mem_peak`). Pinon loppumista ei voi havaita kuin laitteella.
- **Tulkin erot:** Shelly ajaa muokattua Espruino-tulkkia. Node.js hyväksyy asioita, jotka laitteessa kaatuvat. Havaittuja eroja: sisäkkäiset nimettömät funktiot, `JSON.stringify` ja virheellinen UTF-8, kokonaislukujen muistinkulutus, lokirivin 128 merkin raja.
- **Nopeus:** simulaattorissa kaikki on välitöntä. Laitteessa yksi lause kestää 0,2-0,5 millisekuntia ja funktiokutsu 2-3 millisekuntia.
- **Verkko:** TLS:ää ja oikeita viiveitä ei simuloida, ja vastauksen HTTP-otsakkeet ovat pelkistetyt.
- **Minimointi:** testit ajavat lähdekoodia. Valmiin buildin voi ajaa samoilla testeillä (ks. yllä).

Lopullinen testaus tehdään aina laitteella.

## Laitteilla tehdyt testit

Versio 10.0.0 on testattu kolmella laitemallilla. Uudet laitteet testattiin ensin tehdasversion laiteohjelmistolla ja sen jälkeen jokaisella päivitysaskeleella erikseen, koska laiteohjelmistojen välillä on eroja skriptien suorituksessa.

| Laite | Sukupolvi | Laiteohjelmistot |
| --- | --- | --- |
| Shelly Outdoor Plug S Gen3 | 3 | 2.0.1 |
| Shelly 1 Gen4 | 4 | 1.5.99 (tehdasversio), 2.0.1 |
| Shelly Pro 2 | 2 | 1.3.2 (tehdasversio), 1.3.3, 2.0.1 |

Jokaisella laitteella ja laiteohjelmistolla ajettiin uusi asennus tyhjään laitteeseen (`--fresh`), päivitys versiosta 3.4.0 sen asetuksilla (`--upgrade`) ja kaikki viisi lisäosaversiota. Kellotestit ajettiin, kun laiteohjelmisto sallii kellon asettamisen. Luvut ovat onnistuneita tarkistuksia; yhtään epäonnistunutta ei jäänyt.

| Laite, laiteohjelmisto | Uusi asennus | Päivitys 3.4.0:sta | Lisäosat | Kellotestit | Pitkä ajo |
| --- | --- | --- | --- | --- | --- |
| Outdoor Plug S Gen3, 2.0.1 | 71 (kellotestien kanssa) | 74 | 5/5 | mukana | viikko, yksi ohjaus (30 min tarkkuus, kaksi omaa jaksoa) |
| Shelly 1 Gen4, 1.5.99 | 69 (kellotestien kanssa) | 74 | 5/5 | mukana | vuorokausi, yksi ohjaus (15 min tarkkuus, maksimihinta, varmuustunnit) |
| Shelly 1 Gen4, 2.0.1 | 71 (kellotestien kanssa) | 74 | 5/5 | mukana | viikko, yksi ohjaus (15 min tarkkuus, maksimihinta, varmuustunnit, kausisiirto) |
| Pro 2 Gen 2, 1.3.2 | 68 | 82 | 5/5 | ei mahdollinen* | vuorokausi, kaksi ohjausta (30 min halvimmat kahdella jaksolla, keskihintaraja ja pakko-ohjaus pois) |
| Pro 2 Gen 2, 1.3.3 | 68 | 82 | 5/5 | ei mahdollinen* | vuorokausi, kaksi ohjausta (30 min halvimmat kahdella jaksolla, keskihintaraja ja pakko-ohjaus pois) |
| Pro 2 Gen 2, 2.0.1 | 78 (kellotestien kanssa) | 82 | 5/5 | mukana | viikko, kolme ohjausta (30 min halvimmat kahdella jaksolla, keskihintaraja ja pakko-ohjaus pois, 15 min halvimmat maksimihinnalla ilman lähtöä) |

\* Laiteohjelmistoissa 1.3.2 ja 1.3.3 ei ole kellon asetusta (`Sys.SetTime`).

Vuorokauden ajoissa laitteet olivat yhtäjaksoisesti käynnissä vuorokauden vaihteen ja seuraavan päivän hintojen haun yli, ja jokaista releen kytkentää verrattiin tilasivun laskemaan suunnitelmaan: ristiriitoja ei ollut. Toisessa ajossa (Gen4 2.0.1, Pro 2 1.3.3 ja plug yhtä aikaa samassa verkossa) hintahaut keskiyöllä ja kello 15 tapahtuivat laitekohtaisilla viiveillä eri hetkinä, eikä yhtään hakua epäonnistunut.

Viikon yhtäjaksoisessa ajossa olivat mukana kaikki kolme laitetta laiteohjelmistolla 2.0.1 (Pro 2 pelkällä kaapeliyhteydellä), yhteensä viisi ohjausta:

- **Ohjaus:** jokainen releen kytkentä vastasi tilasivun laskemaa suunnitelmaa.
- **Talviaikaan siirtyminen** osui ajoon: kellonsiirtopäivän 25 tunnin hinnat haettiin kokonaisina, eikä hintoja haettu uudelleen kellonsiirron kohdalla.
- **Kausisiirto** oli käytössä Shelly 1 Gen4:llä: maanantaista lauantaihin päiväsiirto kello 07-22, sunnuntaina yösiirto koko päivän. Ero näkyi päivän keskihinnoissa verrattuna Pro 2:een, jolla oli samat siirtohinnat aikasiirtona.
- **Kellonsiirtopäivän viat:** ajo paljasti kaksi vikaa, jotka korjattiin ja joille lisättiin simulaattoritestit. Kausisiirto käytti kellonsiirron jälkeen lauantain päiväsiirtoa, ja kello 00 alkava jakso alkoi kellonsiirron jälkeen vasta kello 01.
- **Eleringin keskiyön häiriö:** rajapinta oli kolmena yönä seitsemästä hetken poissa käytöstä heti keskiyön jälkeen. Kaikkien laitteiden varmistushaku epäonnistui kolmesti, ja uusintayritys haki hinnat ilman käyttäjän toimia. Tämän vuoksi haut siirrettiin 3-5 minuuttia tasatunnin jälkeen.
- **Cloudflaren pitkät otsakkeet** osuivat Pro 2:lle kahteen hakuun noin kuudestatoista, muille laitteille ei kertaakaan. Ero oli sattumaa: kaikkien laitteiden pyynnöt ovat samanlaiset (ks. docs/vertailu-3.4.0.md). Hintahaun tilastot (`s.fH`, `s.fPk`, `s.fPkH`) näyttivät tämän suoraan.

Havainnot laiteohjelmistoista:

- **1.3.2 (Pro 2, tehdasversio)** käsittelee lohkon sisällä esiteltyjä `let`- ja `const`-muuttujia kuin `var`-muuttujia. Minimoitu koontiversio kaatui siihen käynnistyksessä, kunnes koontivaihe muutettiin muuttamaan `let` ja `const` `var`-muotoon (ks. `build-scope.test.js`). Alkuperäinen 3.4.0 käynnistyy tällä laiteohjelmistolla.
- **1.3.2 ja 1.3.3** eivät tarjoa kellon asetusta (`Sys.SetTime`); 2.0.1 tarjoaa, ja Pro 2:n kellotestit ajettiin sillä.
- **1.5.99 (Shelly 1 Gen4, tehdasversio) ja 2.0.1** toimivat samoin; skriptimuistin koko on kaikissa sukupolvissa 25 186 tavua.
- **Matter:** Shelly 1 Gen4 on testattu Matter päällä (ei paritettu) ja pois: skripti toimii molemmissa, skriptimuisti on sama 25 186 tavua ja laitteen vapaa muisti noin 35 kB pienempi Matter päällä. Outdoor Plug S Gen3:lla (2.0.1) Matter päällä skripti ei käynnisty lainkaan: se pysähtyy heti virheeseen `out_of_memory`, koska laitteen vapaa muisti putoaa noin 138 kB:sta 94 kB:iin. Matter pois päältä ja laitteen uudelleenkäynnistys palauttaa toiminnan. Kaikki muut testit on ajettu Matter pois päältä (plug) tai päällä (Gen4).

Pro 2:lla on lisäksi tehty kaapeliverkon testit (kaapeli ja Wi-Fi yhtä aikaa samassa verkossa sekä pelkkä kaapeli, Wi-Fi pois: käynnistysrivin osoite, hintahaku, käyttöliittymä ja laitetesti kaapeliosoitteen kautta) sekä sähkökatkosta toipuminen.

Sähkökatkosta toipuminen on testattu kaikilla kolmella laitteella katkaisemalla virta: skripti käynnistyi itsestään, ja kellonaika, molempien päivien hinnat ja ohjaus olivat kunnossa noin 10-30 sekunnissa virran palattua. Asetukset säilyivät. Ilman käynnistyksen lämmittelyaikaa ohjaus toimi ennen kellonajan saamista hätätila-asetuksen mukaan ja kytki lähdön kahdesti (näkyi historiassa rivinä, jonka aika ei ole tiedossa); lämmittelyajan kanssa lähtö kytkettiin vain kerran, suoraan hinnan mukaan (testattu kaikilla kolmella laitteella).

Pidemmässä ajossa laitteen kytkentähistoriaa verrattiin tilasivun laskemaan suunnitelmaan: ne olivat samat.

Kaapeliverkon testissä käynnistysrivin osoite tarkistettiin ajamalla rivin lauseke käynnissä olevassa skriptissä (`Script.Eval`), koska laitteen lokia ei voi lukea jälkikäteen: tulos oli kaapeliliitännän osoite.

Vain simulaattorissa on testattu (talviaikaan siirtyminen on todennettu laitteilla viikon ajossa, ks. yllä):

- kesäaikaan siirtymisen päivä hintojen kanssa
- lämpötila-antureita käyttävät lisäosat oikealla anturilla
- kolmen tai neljän lähdön laitteet

## Korjatut viat testeinä

`known-issues.test.js` sisältää löydetyt viat testeinä, jotka kuvaavat toivotun käyttäytymisen. Uuden vian voi lisätä todo-testinä: se ajetaan, mutta epäonnistuminen ei kaada testiajoa. Kun korjaus on valmis, testi menee läpi ja `todo`-merkinnän voi poistaa.

```js
test('kuvaus toivotusta toiminnasta', { todo: true }, () => { ... });
```
