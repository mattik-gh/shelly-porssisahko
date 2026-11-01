# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [10.0.0] - 1.11.2026

**Muokattu versio** ([@mattik-gh](https://github.com/mattik-gh)), joka perustuu alkuperäiseen versioon 3.4.0.
Alkuperäinen tekijä ei vastaa tämän version tuesta. Versionumerossa on tarkoituksella väli alkuperäiseen.

Tarkempi vertailu alkuperäiseen: [docs/vertailu-3.4.0.md](docs/vertailu-3.4.0.md). Testaus: [test/README.md](test/README.md).

### Uudet ominaisuudet
- **15 ja 30 minuutin hintaohjaus**: ohjaus voi käyttää pörssin 15 minuutin hintoja sellaisenaan tai niiden 30 tai 60 minuutin keskiarvoa. Tarkkuus valitaan ohjauskohtaisesti asetuksella "Hinnan tarkkuus". Oletus on 60 minuutin keskiarvo, joka toimii samoin kuin alkuperäisessä versiossa 3.4.0
  - Logiikka ajetaan ja lähdön tila voi vaihtua valitun tarkkuuden mukaan 15, 30 tai 60 minuutin välein
  - Tuntimäärän voi antaa desimaaleina: 30 min tarkkuudella 0.5 h välein, 15 min tarkkuudella 0.25 h välein
- **Kausisiirto**: yleisissä asetuksissa valitaan siirtotuote. Aikasiirto (oletus) toimii kuten ennen: päivämaksu joka päivä klo 07-22. Kausisiirrossa päivämaksu on voimassa 1.11.-31.3. maanantaista lauantaihin klo 07-22, muulloin yömaksu. Käytössä olevat päivät ja kellonajat näkyvät asetussivulla maksujen kohdalla. Ne voi tarvittaessa muuttaa etäasetusten skriptillä (uudet yleiset asetukset `tt`, `ss`, `se`, `ds` ja `de`), ja kellonajat koskevat myös aikasiirtoa. Arkipyhiä ei huomioida
- **Tilasivun hintakaavio**: pylväs jokaiselle hinnalle, siirtomaksun ja energian osuus erikseen, ja pylväiden alla palkki, joka näyttää suunnitellun ohjauksen
  - Jaksot näkyvät ohuena viivana pylväiden ja ohjauspalkin välissä (peräkkäiset jaksot tummana ja vaaleana, vihjeessä jakson alku ja loppu)
  - Selitteessä näkyy päivän suunniteltu kytkentäaika yhteensä, esimerkiksi `Ohjaus päällä (5h 15min)`
  - Negatiivinen energian hinta näkyy kaaviossa nollana. Taulukossa hinta näkyy sellaisenaan
- **Testiympäristö**: Shelly-simulaattori, automaattiset testit ja laitetesti (ks. [test/README.md](test/README.md)). Simulaattori ajaa skriptiä Node.js:ssä simuloiduilla Shellyn rajapinnoilla ilman laitetta, ja sen kanssa voi käyttää myös skriptin käyttöliittymää selaimessa. Automaattiset testit ajetaan sekä lähdekoodia että valmista koontiversiota vastaan
- **Ohjausten määrä** on asetus (1-3). Vain valittu määrä luodaan muistiin, joten pienempi määrä säästää muistia (noin 700 tavua per ohjaus). Muutos tulee voimaan ilman uudelleenkäynnistystä. Uudessa asennuksessa oletus on yksi ohjaus. Kun päivitetään versiosta 3.x, kaikki kolme ohjausta pysyvät käytössä, ja määrän voi pienentää asetuksista. Myöhemmin lisätty ohjaus luodaan oletusasetuksilla
- **Historian pituus** on asetus (0, 24, 48, 72 tai 96 riviä). Historiasivu näyttää päivämäärän ja kellonajan
- **Kerran haetut päivän hinnat pysyvät käytössä**, vaikka samojen hintojen uusi haku epäonnistuisi
  - Saman päivän hinnat säilyvät, vaikka uusi haku ei onnistu
  - Vuorokauden vaihtuessa edellisenä päivänä haetut huomisen hinnat otetaan heti käyttöön. Ne tarkistetaan uudella haulla pian keskiyön jälkeen, ja jos haku epäonnistuu, ne pysyvät käytössä (aiemmin hinnat hylättiin keskiyöllä, ja epäonnistunut haku siirsi ohjauksen varmuustunneille)
  - Päättyneen päivän hintoja ei käytetä uudelle päivälle (kuten ei ennenkään). Jos uuden päivän hintoja ei ole saatu lainkaan, ohjaus toimii varmuustunneilla
- **Ohjauksen keskihinta** tilasivun tunnusluvuissa kertoo, mitä sähkö maksaa keskimäärin niinä jaksoina, joina ohjaus on päivän suunnitelmassa päällä. Se näkyy päivän keskihinnan, halvimman ja kalleimman hinnan rinnalla
- Tilasivulla näytetään yksi päivä kerrallaan (tänään / huomenna) ja ohjaustaulukko on kahdessa palstassa
- **Hintahaun virhelaskuri** historiasivulla: virheiden määrä ja ensimmäisen virheen aika käynnistyksen jälkeen, sekä viimeisimmän katkon alku, loppu ja virheiden määrä
- Varoitus tilasivulla ja asetussivulla, jos ohjaukselle ei ole määritetty lähtöä tai lähtöä ei ole laitteessa
- **Asetussivun ohjeet**: rivin nimi on alleviivattu pisteviivalla, ja ohje aukeaa viemällä hiiri nimen päälle tai napauttamalla sitä. Kosketusnäytöllä ohje sulkeutuu napauttamalla nimeä uudelleen tai mitä tahansa muuta kohtaa
- **Syöttömaskit numerokentissä**: kenttään voi kirjoittaa vain siihen sopivia merkkejä. Hinnoissa ja siirtomaksuissa enintään 3 numeroa ja 2 desimaalia, ALV:ssä ja tuntimäärissä enintään 2 numeroa ja 2 desimaalia. Ohjauksen nimen enimmäispituus on 30 merkkiä
- Asetussivu tarkistaa ennen tallennusta, että asetukset mahtuvat laitteen muistiin (Shellyn raja on 253 tavua per arvo). Jos eivät mahdu, mitään ei tallenneta ja syy kerrotaan
- **Tallennuksen ilmoitus sivulla ilmoitusikkunan sijaan**: Tallenna-painikkeen alla näkyy hetken "Tallennettu", eikä sitä tarvitse kuitata. Virhe näkyy samassa paikassa punaisella ja pysyy näkyvissä, kunnes tallennetaan uudelleen. Sama koskee pakko-ohjauksen virhettä
- **Valintaruutujen arvo näkyy tekstinä** ruudun vieressä: Kyllä / Ei tai Päällä / Pois (aiemmin "ON/OFF" tai ei tekstiä). Tekstiä napauttamalla ruutu vaihtuu, mikä helpottaa käyttöä puhelimella
- **Puhelimen asettelu**: varmuustunnit kuusi rivillä, pakko-ohjauksen rivit katkeavat hallitusti, kielivalinta on suurempi ja ohje sulkeutuu napauttamalla
- **Asetussivulla näkyvät vain valitun ohjaustavan asetukset** (käsiohjaus, hintaraja tai jakson halvimmat tunnit). Muiden ohjaustapojen arvot säilyvät tallessa
- **Pakko-ohjaus asetussivulla** näkyvänä osiona kahden kysymysikkunan sijaan: lähdön tila juuri nyt, kesto ja painikkeet Päällä ja Pois. Voimassa olevasta pakko-ohjauksesta näkyy tila ja päättymisaika, ja sen voi perua painikkeella. Sen aikana voi antaa vain saman suunnan uudelleen (jatko); suunnan vaihto vaatii perumisen. Kesto lasketaan laitteen kellosta (ennen: selaimen kellosta). Lähtö seuraa pakko-ohjausta parissa sekunnissa (ennen: enintään 10 sekunnin kuluttua), ja pyyntö yritetään uudelleen, jos laite on sillä hetkellä varattu
  - Painalluksen jälkeen näkyy odotusmerkki, kunnes laite on ottanut pakko-ohjauksen käyttöön, ja sivu hakee tilan sinä aikana sekunnin välein
- **Pakko-ohjaus HTTP-pyynnöllä minuutteina**: uusi parametri `mi` (kesto minuutteina tästä hetkestä, `0` peruu). Aiempi `ts` (päättymisaika) toimii ennallaan
- **Asetusten muuttaminen HTTP-pyynnöllä**: uusi pyyntö `r=w` muuttaa ohjauksen tallennettuja asetuksia nimetyillä parametreilla ja ottaa muutetut asetukset käyttöön: käytössä (`en`), lähdöt (`o`), pakko-ohjatut tunnit (`f`), tuntimäärät (`m2.c`, `m2.c2`), hintarajat (`m1.l`, `m2.l`, `m2.m`) ja käsiohjauksen tila (`m0.c`). Ohjaustapaa pyyntö ei vaihda
- **HTTP-rajapinta** on kuvattu README:ssä
- **Tilasivun alatunniste**: käynnistysaika ja käyntiaika laitteen kellosta, skriptin muistin käyttö (levossa, suurin käyttö käynnistyksen jälkeen ja käytettävissä oleva muisti) sekä versio
- **Peräkkäiset tunnit jaksoittain**: kahden oman jakson kanssa "Peräkkäiset" valitaan kummallekin jaksolle erikseen (uusi asetus `m2.s2`). Vanhoissa asetuksissa jakso 2 saa saman arvon kuin jakso 1, joten toiminta ei muutu päivityksessä
- **Kaksikielinen käyttöliittymä** (suomi / englanti) samasta koodista. Kieli valitaan selaimen kielen mukaan ja sen voi vaihtaa sivun yläreunan FI | EN -valinnalla (valinta tallentuu selaimeen). Englanninkieliset tekstit ovat tiedostoissa `src/statics/en.js` ja `src/statics/en-config.js` (asetussivun tekstit), ja laite lähettää ne vain englanninkieliseen käyttöliittymään

### Muuttunut toiminta
- **Asetusten tallennusmuoto ja muistipaikat**: asetukset tallennetaan KVS-muistiin arvojen listana ilman asetusten nimiä, avaimiin `porssisahko` ja `porssisahko-1`...`porssisahko-3` (aiemmin JSON-teksti avaimissa `porssi`...). Pisimmätkin asetukset ovat nyt noin puolet Shellyn pituusrajasta. Version 3.x asetukset luetaan kerran päivityksen yhteydessä, ja niiden mukaisesti tehdään version 10 asetukset. Sen jälkeen version 3.x asetuksia ei enää käytetä eikä niihin kirjoiteta
- **Asetusten tallennus ei enää hae hintoja uudelleen.** Poikkeus: maan vaihtaminen
- **Laitteen käynnistyksen jälkeen** lähtöjä ei ohjata ennen kuin kellonaika on saatu tai kolme minuuttia on kulunut (aiemmin hätätilaohjaus kytki lähdön heti ja hintaohjaus kytki sen takaisin muutamaa sekuntia myöhemmin, eli jokainen sähkökatko aiheutti turhan kaksoiskytkennän). Sinä aikana lähtö on Shellyn oman käynnistysasetuksen mukaisessa tilassa. Samoin varmuustunnit otetaan käyttöön vasta, kun hintojen haku on epäonnistunut kolmesti peräkkäin (noin 15 sekuntia), eikä heti ensimmäisestä epäonnistumisesta. Käsiohjaus toimii heti kuten ennen
- **Epäonnistuneen hintahaun uusintayritykset harvenevat**: kolme yritystä noin 5 sekunnin välein, sitten yksi yritys 2 minuutin välein kolmesti ja sen jälkeen 10 minuutin välein, kunnes haku onnistuu (aiemmin kolme yritystä 2 minuutin välein jatkuvasti). Nopeat ensimmäiset yritykset auttavat hetkellisessä häiriössä, ja pidemmässä katkossa harvempi tahti noudattaa hyvää tapaa olla toistamatta pyyntöjä palveluun tiheästi. Maan vaihto hakee hinnat heti, ja vuorokauden vaihtuessa haku tehdään normaalin aikataulun mukaan (ks. seuraava kohta)
- **Hintahaut kello 15 ja vuorokauden vaihtuessa** tehdään laitekohtaisella viiveellä 3-5 min tasatunnin jälkeen. Viive lasketaan laitteen MAC-osoitteesta, joten saman käyttöpaikan laitteet eivät hae samalla hetkellä eikä tasatunnin hakuihin (esim. versio 3.x:n ensimmäiset 10 s) osuta. Eleringin rajapinnassa on toisinaan noin 1-2 minuuttia ongelmia tavoitettavuudessa heti keskiyön jälkeen, ja viive ohittaa sen. Keskiyöllä seuraavan päivän hinnat ovat jo käytössä, joten viive ei vaikuta ohjaukseen. Käynnistyessä ja asetusten muuttuessa hinnat haetaan heti
- **Jos yhden ohjauksen ajo epäonnistuu, muut ohjaukset ajetaan silti.** Ohjaukset ajetaan muuten aina järjestyksessä #1, #2, #3, kuten ennenkin
- **Lähtöä, jota laitteessa ei ole, ei yritetä ohjata** 10 sekunnin välein uudelleen, vaan siitä näytetään varoitus
- **Tilasivulla laitteen nimenä** näytetään "Shelly", jos laitteelle ei ole annettu nimeä (aiemmin kursivoituna "Ei asetettu")
- **Tyhjä lähtölista tarkoittaa "ei lähtöjä"**: logiikka ajetaan, mutta lähtöihin ei kosketa. Asetussivu tallentaa tyhjän kentän lähtönä 0
- **Tilasivun** kuluvan rivin korostus käyttää laitteen kelloa selaimen kellon sijaan
- **Peräkkäisten tuntien valinta** voi poiketa aiemmasta vain, jos kahden jakson hintasumma on täsmälleen sama
- **Hintahaun virheestä kirjoitetaan lokiin vain vastauskoodi ja vastauksen pituus.** Lokirivin linkki alkuperäisen projektin issueen on korvattu viittauksella READMEen (`see README`)
- **Historiarivi**, joka kirjataan ennen kuin laite on saanut kellonajan, näkyy ajalla `00.00.0000 00:00`
- **Historian kellonaika on minuutin tarkkuudella**. Rivit näytetään tapahtumajärjestyksessä, uusin ylimpänä
- **Käynnistyksen lokirivi** näyttää kaapeliverkon osoitteen, jos laite on kytketty kaapelilla. Käyttämättömän yhteyden osoitetta `0.0.0.0` ei näytetä
- **Sivu on leveämpi**, ja tilasivun otsikko "Keskiarvo" on nyt "Keskihinta"

### Korjatut viat: pörssiohjaus
- **Virheellinen asetus KVS-muistissa** (rikkinäinen JSON tai väärän tyyppinen arvo) pysäytti skriptin tai jätti sen pysyvästi jumiin
- **Jakson pituus 0** aiheutti päättymättömän silmukan laitteessa ja tilasivulla
- **Asetusten latauspyyntö** ilman kelvollista ohjauksen numeroa pysäytti skriptin. Pyyntö ilman numeroa lataa nyt kaikkien ohjausten ja yleiset asetukset
- **Tyhjä lähtölista** jätti skriptin pysyvästi jumiin
- **Asetusten latauspyyntö hukkui**, jos skriptin suoritus oli sillä hetkellä aktiivinen
- **Puutteellisia asetuksia ei täydennetty**, kun asetukset ladattiin uudelleen ajon aikana
- **Virheellinen lähdön numero** ohjauksessa #1 esti ohjaukset #2 ja #3
- **Uudessa asennuksessa** ohjaukset jakoivat saman asetusolion, joten yhden muutos näkyi muissa
- **Kellonsiirtopäivät**:
  - Hintoihin tuli mukaan viereisen päivän tunteja
  - Talviaikaan siirryttäessä logiikkaa ei ajettu toistuvalla tunnilla
  - Kesäaikaan siirryttäessä jaksojen rajat olivat loppupäivän tunnin myöhässä (esim. oma jakso 07-20 toimi 08-21)
  - Talviaikaan siirryttäessä päivän viimeinen tunti puuttui hinnoista ennen kellonsiirtoa ja ensimmäinen sen jälkeen. Nyt kellonsiirtopäivän hinnat haetaan kokonaisina (pyyntö on tunnin pidempi kummastakin päästä), ja kello 00 alkava tai kello 24 päättyvä jakso kattaa myös 25 tunnin päivän ensimmäisen ja viimeisen tunnin
  - Kellonsiirto haki päivän hinnat uudelleen kaikilla laitteilla samalla sekunnilla. Nyt hintoja ei haeta uudelleen, kun ne ovat muistissa: hinnat on tallennettu aikaleimoittain, joten ne pysyvät oikeina kellonsiirron yli. Muu aikavyöhykkeen muutos hakee hinnat uudelleen kuten ennen
- **Kellon siirtyessä taaksepäin** virheiden jälkeinen tauko hintahaussa ei päättynyt
- **Hintakatkon aikana** logiikka ajettiin ja lähdöt kirjoitettiin turhaan jokaisen epäonnistuneen haun jälkeen, myös kun tämän päivän hintoja ei ollut lainkaan ja ohjaus oli varmuustunneilla. Nyt logiikka ajetaan katkon aikana vain varmuustuntien alkaessa ja tasatunneilla
- **Virheellinen vastaus hintahaussa** (esim. virhesivu) saattoi kaataa skriptin muistin loppumiseen

### Korjatut viat: käyttöliittymä
- **Asetussivu** saattoi tallennuksen jälkeen näyttää hetken kuluttua vanhat arvot, vaikka tallennus oli onnistunut, koska laite palauttaa vanhat asetukset vielä muutaman sekunnin ajan. Uusi tallennus olisi silloin kirjoittanut vanhat arvot takaisin. Nyt kentät täytetään laitteelta vasta, kun laitteella on tallennetut asetukset. Jos laitteen asetukset poikkeavat tallennetuista vielä 15 sekunnin kuluttua, kentät päivitetään laitteen arvoihin
- **Asetusten tallennus** epäonnistui, kun asetukset olivat pitkät (virhe `length should be less than 255`). Alkuperäisessä versiossa raja ylittyi vain äärimmäisillä asetuksilla, esimerkiksi kun kaikki varmuustunnit oli valittu, kaikki tunnit pakko-ohjattu päälle ja lähtöjä oli neljä. Tämä ei ole todellinen käyttötilanne, mutta teknisesti tallennusraja tuli jo silloin vastaan. Shelly sallii arvolle 253 tavua ja laskee pituuden siitä muodosta, jossa teksti tallennetaan: UTF-8-koodattuna JSON-merkkijonona. Tavallinen merkki vie yhden tavun, esimerkiksi ä kaksi, ja lainausmerkki ja kenoviiva kaksi, koska ne tallennetaan escape-merkillä suojattuina (`\"` ja `\\`). Kyse on yleisestä tallennustavasta, ei tämän skriptin erikoistapauksesta. Kun asetukset tallennettiin nimineen JSON-tekstinä, ohjauksen asetuksissa oli 54 lainausmerkkiä, joten todellista tallennustilaa jäi alle 200 merkkiä. Uusi tallennusmuoto vie selvästi vähemmän tilaa, joten myös version 10 uudet asetukset mahtuvat tähän rajaan (ks. Muuttunut toiminta)
- **Sivu ei auennut iPhonen Brave-selaimella** (virhe `"" is not a constructor`). Sivun koodissa oli muuttuja nimeltä `URL`, joka peitti selaimen saman nimisen toiminnon myös selaimen sivulle lisäämältä koodilta. Vika oli jo alkuperäisessä versiossa, ja se näkyi iPhonessa, kun Braven seuranta- ja mainosesto oli päällä (oletus). Tietokoneen Bravessa vikaa ei ollut

### Korjatut viat: lisäosat
- `shelly-porssisahko-1-instance-no-history.js`: historia kasvoi rajatta, vaikka sen piti olla pois käytöstä
- `shelly-porssisahko-ht-sensor-temp.js`: lämpötilan enimmäisikää verrattiin väärässä yksikössä, jolloin vanhentunutta lukemaa käytettiin. Raja on nyt 12 tuntia, kuten asetuksen nimi sanoo
- `shelly-porssisahko-addon-temp.js`: lämpötila otettiin huomioon vain, kun ohjaus muutenkin tarkistettiin, eli tuntitarkkuudella kerran tunnissa (alkuperäisen projektin issue #39). Nyt lämpötilan muutokseen reagoidaan noin 10 sekunnissa. Rajoille on hystereesi (oletus 0,5 °C), jotta lähtö ei kytkeydy edestakaisin rajan kohdalla, ja lämpötilan takia tehtävien tarkistusten väli on vähintään 5 minuuttia. Rajat, hystereesi, vähimmäisväli ja nopean reagoinnin valinta ovat muuttujina lisäosan alussa
- `shelly-porssisahko-addon-temp.js` ja `shelly-porssisahko-addon-temp-hours.js`: lämpötila-anturin numero on muuttujana `TEMP_SENSOR` lisäosan alussa (oletus 100 kuten ennen). Aiemmin luettiin aina anturia 100, joten useamman anturin Add-onissa ei voinut valita käytettävää anturia
- `shelly-porssisahko-open-meteo-api.js`: jos sääennustetta ei saatu, lähtöä ei ohjattu lainkaan. Nyt ohjataan asetetuilla tunneilla ja ennuste haetaan uudelleen seuraavalla logiikan ajolla
- `shelly-porssisahko-config.js`:
  - Pohjaan lisätty uudet asetukset (ohjausten määrä, historian pituus, hinnan tarkkuus, jakson 2 peräkkäiset tunnit, siirtotuote sekä siirtomaksujen päivät ja kellonajat)
  - Ohjausten #2 ja #3 muutokset tulevat voimaan heti (aiemmin vasta pääskriptin uudelleenkäynnistyksessä)
  - Lähtö- ja nimilista korvataan kokonaan (aiemmin listaa ei voinut lyhentää)

### Huomioitavaa päivittäessä
- **Asetukset säilyvät päivitettäessä versiosta 3.x.** Uudet asetukset saavat oletusarvot
- **Paluu versioon 3.x onnistuu asentamalla version 3.x skripti takaisin.** Sen asetukset ovat tallessa omissa muistipaikoissaan siinä tilassa kuin päivityshetkellä. Version 10 aikana tehdyt asetusmuutokset eivät siirry takaisin
- **Oma ohjelma tai skripti, joka kirjoittaa asetuksia suoraan KVS-muistiin**, pitää päivittää uusiin avaimiin ja uuteen tallennusmuotoon (ks. README, Mihin asetukset tallentuvat?). Vanhoihin avaimiin kirjoitettu asetus ei enää vaikuta. Erillinen asetusskripti `shelly-porssisahko-config.js` on päivitetty
- **Omat lisäskriptit**: hinnat (`_.p`) ja historia (`_.h`) ovat nyt pakattuja merkkijonoja. Skripti, joka lukee niitä suoraan, ei toimi muuttamatta. `_.s.p[0].now`, `avg`, `low` ja `high` sekä asetukset (`_.c`) toimivat kuten ennen
- **Tilarajapinta** (`?r=s` ja `?r=h`): hinnat ja historia palautetaan base64-muodossa. Ulkoinen ohjelma, joka lukee näitä, pitää päivittää; valmiit purkufunktiot version 3.4.0 muotoon ovat tiedostossa docs/unpack.md. Tilavastauksessa on uusi kenttä `m` (skriptin muisti: käytössä levossa, huippu ja koko muisti tavuina) sekä hintahaun tilastoja (`s.fB`, `s.fH`, `s.fPk`, `s.fPkTs`, `s.fPkH`: vastauksen ja otsakkeiden pituus, haun nostama muistihuippu)
- **Ulkoinen ohjelma, joka laskee siirtomaksut itse**: kausisiirrossa siirtomaksu riippuu päivämäärästä ja viikonpäivästä. Purkufunktiolle (docs/unpack.md) annetaan siksi yleiset asetukset uutena valinnaisena parametrina. Ilman sitä se laskee kuten ennen
- Skriptin koko kasvoi (22,5 kt -> 45,6 kt, lisäosaversiot 49-52 kt). Koko ei vaikuta laitteen muistinkäyttöön eikä toimintaan, ainoa raja on Shellyn sallima skriptin enimmäiskoko 65,5 kt
- **Koontivaihe** muuttaa skriptin `let`- ja `const`-muuttujat `var`-muotoon ennen minimointia. Vanhemmat laiteohjelmistot (esimerkiksi Gen 2:n 1.3.2) käsittelevät lohkon sisällä esiteltyä `let`-muuttujaa kuin `var`-muuttujaa, jolloin lohkon muuttuja voi ylikirjoittaa samannimisen ulomman muuttujan. Minimoidussa koodissa tämä tulee esiin herkemmin, koska minimointi lyhentää eri muuttujien nimet samoiksi kirjaimiksi ja yhdistää funktioita. Tämä vaikuttaa vain muodostetun scriptin lopputuloksen sisältöön, eikä siten ole vaikutusta koodin kirjoittamiseen tai scriptin käyttäjälle - patsi scripti toimii tältä osin nyt luotettavasti eikä aiheuta täysin satunnaisia ongelmia buildin optimoinneista ja laiteohjelmiston versiosta riippuen.
- **Testattu laitteilla** Shelly Pro 2 Gen2 (laiteohjelmisto 1.3.2, 1.3.3 ja 2.0.1), Shelly Outdoor Plug S Gen3 (2.0.1) ja Shelly 1 Gen4 (1.5.99 ja 2.0.1), jokaisella uutena asennuksena ja päivityksenä versiosta 3.4.0. Pro 2 on testattu sekä Wi-Fillä että kaapeliverkossa. Tulokset laiteohjelmistoittain: test/README.md

## [3.4.0] - 04.11.2025
- Historia palautettu ennalleen vastaamaan v. 3.2.0
- Muistin käyttö testattu Shelly Pro3:lla (kolme ohjausta ja historia) - reserviä jää vielä ~4000 tavua

```
script:1: {
  id: 1,
  running: true,
  mem_used: 11886,
  mem_peak: 21434,
  mem_free: 13300,
  cpu: 2
},
```

## [3.3.1] - 01.11.2025
- Bugikorjaus: Desimaalipilkku ei toiminut (vain piste)
  - Kiitos [https://github.com/vaahtokarkki](https://github.com/vaahtokarkki)

## [3.3.0] - 30.09.2025
- Tuki 15 minuutin välein vaihtuvalle sähkön hinnalle
  - Skripti laskee jokaiselle tunnille hinnan keskiarvon ja toimii tunneittain, kuten ennenkin
- HUOM: Historia toistaiseksi pois käytöstä, kunnes max. muistin käyttö hahmottuu paremmin.

## [3.2.0] - 10.02.2025
- Historiaan tallennetaan rivi vain ohjauksen muuttuessa
- Bugikorjaus: Käsiohjauksen tila näkyi väärin tilasivulla
  - Kiitos [https://github.com/jpsarin](https://github.com/jpsarin)!
- Bugikorjaus: Ohjausta vaihtaessa perutaan aina mahdollinen edellinen datan haku
  - Toivottavasti korjaa [issue #45](https://github.com/jisotalo/shelly-porssisahko/issues/45)

## [3.1.1] - 24.11.2024
- Bugikorjaus: Käänteinen ohjaus ei näkynyt oikein tilasivulla
  - Kiitos [https://github.com/joomoz](https://github.com/joomoz)!

## [3.1.0] - 22.11.2024
- Lisätty tarkistus kellonajan muuttumiselle
  - Jos aika muuttuu yllättäen yli 5 min, haetaan hinnat ja suoritetaan logiikat uusiksi
  - Esim. pitkään ilman nettiyhteyttä ja kello alkaa näyttää väärin
- Bugikorjaus: Shellyn käynnistyessä päivämäärä ja aika saattoivat olla hetken aikaa menneisyydestä
  - Aiemmissa firmiksissä vuosi oli aina 1970 jos aika ei ollut tiedossa, ei enää
  - Muutettu käyttämään toista tapaa varmistamaan, että onko kellonaika tiedossa
  - Liittyy [issue #33](https://github.com/jisotalo/shelly-porssisahko/issues/33)
- Bugikorjaus: Jos nykyistä tuntia ei löydy hintatiedoista, hylätään hinnat ja haetaan ne uusiksi
  - Liittyy [issue #33](https://github.com/jisotalo/shelly-porssisahko/issues/33)
- Bugikorjaus: Jos maksimihinta oli pienempi kuin aina päällä -raja, näytettiin ohjauksia väärin tilasivulla.
  - Ohjaus kuitenkin toimi kuten suunniteltu
  - [Katso issue #31](https://github.com/jisotalo/shelly-porssisahko/issues/31)

Samalla lisätty ohjeet `shelly-porssisahko-ht-sensor-temp.js` -skriptiin, miten käyttää sitä uudempien H&T-mallien kanssa.

## [3.0.0] - 12.11.2024
**HUOM:** Päivittäessä v.2 -> v.3 asetukset nollaantuvat.

- Tuki kolmelle yhtäaikaiselle ohjaukselle
  - Jokaiselle voidaan määrittää omat asetukset ja lähdöt
  - Käyttöliittymässä valitaan, minkä ohjuksen tilaa, historiaa ja asetuksia käytetään.
- Näytetään ohjausrivillä ***, jos kyseessä on pakko-ohjaus
- Parannettu toimintaa vikatilanteissa (jos hinnat puuttuvat / virheelliset)
- Jos sivun lataaminen epäonnistuu, mahdollistetaan uudelleenyritys
- Oletus-ALV muutettu 25.5%
- Maan valinta
- Paljon parannuksia ja optimointeja konepellin alla
- Asetukset tallennetaan JSON-muodossa (voi muokata käsin KVS alta)

## [2.13.0] - 14.07.2024
- Muutos: Kun vuorokausi vaihtuu, hinnat haetaan aina varalta uudelleen ([Katso issue #26](https://github.com/jisotalo/shelly-porssisahko/issues/26))
  - Aiemmin käytettiin jo tiedossa olevia hintoja datan säästämiseksi ja optimoimiseksi
  - Aiemmin jos Nordpoolin hinnoissa oli klo 15:00 virheitä, virheelliset hinnat jäivät voimaan, vaikka korjattu data oli ollut saatavilla

## [2.12.5] - 02.04.2024
- Bugikorjaus: Seuraavan päivän hinnat haettiin kesäaikaan siirtymisen takia vasta 16:00 (15:00 sijaan)

## [2.12.4] - 20.03.2024
- Bugikorjaus: Korjattu `vain muuttuessa` -ohjausasetus
  - Ohjaus saatettiin ylikirjoittaa vaikka ei pitänyt
  - Historiaan kirjoitettiin tuplarivejä

## [2.12.3] - 09.03.2024
- Lisätty mahdollisuus pyytää `USER_OVERRIDE`-funktiosta logiikan uudelleen suoritusta (palauttamalla `null` takaisinkutsulla)
- Lisätty uusi esimerkki: **Ulkolämpötilan hakeminen sääpalvelusta ja sen hyödyntäminen** (`shelly-porssisahko-open-meteo-api.js`)
  - Hakee kuluvan vuorokauden alhaisimman lämpötilan Open-Meteo-palvelusta koordinaattien perusteella ja muuttaa sen perusteella ohjaustunteja

## [2.12.2] - 06.03.2024
- Uusi ominaisuus: Vapaavalintaiset ajanjaksot
  - Voi valita yhden tai kaksi vapaavalintaista ajanjaksoa ja niille halutut tuntimääräät
  - Esim *"kolme halvinta tuntia yöllä kello 00-06 väliltä ja yksi halvin tunti illalla kello 18-21 väliltä"*

## [2.11.2] - 05.02.2024
- Bugikorjaus: Hinnan keskiarvon laskennan virhe
  - Alussa laskenta näytti oikein, mutta joka päivä virhe alkoi kasvaa suuremmaksi

## [2.11.1] - 01.02.2024 (2)
- Bugikorjaus: Skripti ei aina käynnistynyt oikein Shellyn bootatessa / herätessä
  - **HUOMIO: Koskee versioita 2.90...2.11.0!**
  - Useamman lähdön ohjauksen yhteydessä tullut bugi, joka aiheuttaa välillä skriptin kaatumisen Shellyn käynnistyksen yhteydessä.

## [2.11.0] - 01.02.2024
- Seuraavan päivän hinnat ja toteutuva ohjaus etusivulla
- Uusi asetus: Lähdön ohjaus
  - Voi asettaa niin että lähtö asetetaan vain sen muuttuessa
  - Näin ohjauksen ylikirjoitus toimii kätevämmin Shellyn sovelluksesta tai hallinnasta
- Ohjaushistorialle oma välilehti
- Pieniä parannuksia ja optimointeja
- Lisätty esimerkki kuink Plus Add-onin mittaamalla lämpötilalla voidaan muuttaa halvimpien tuntien määrää

## [2.10.2] - 21.01.2024(2)
- Lisätty koodin tarkistus että halvimpien tuntien lukumäärä <= jakson pituus
  - Havaittu ongelma kun H&T skriptissä oli isompi tuntimäärä (koska käyttäjän skriptin muutoksia ei tarkisteta)

## [2.10.1] - 21.01.2024
- Pakko-ohjauspainikkeella voi valita, haluaako pakko-ohjata ohjauksen päälle vai pois
- Tuntikohtaisissa pakko-ohjauksissa voi valita, haluaako pakko-ohjata ohjauksen päälle vai pois
- Uusi asetus: Ohjausminuutit
  - Voidaan määritellä montako tunnin ensimmäistä minuuttia ohjaus on päällä (mahdollistaa esim. 30 minuutin ohjaukset)
  - Vakiona 60 min, eli koko tunti (kuten ennenkin)
- Lisätty parametreja `USER_CONFIG`-kutsuun
- Mahdollista näyttää lisätietoa käyttöliittyällä käyttäjäskriptin/hienosäätöskriptin tilasta, päivitetty esimerkit sen mukaiseksi
- Lisätty esimerkki kuinka Shelly H&T lämpötilaa voi hyödyntää ohjauksessa

## [2.9.0] - 16.12.2023
- Uusi ominaisuus: Useamman lähdön ohjaaminen samaan aikaan
  - Ohjattavat lähdöt -kenttään voi asettaa useamman lähdön pilkuilla erotettuna, esim `0,100` asettaa skriptin ohjaamaan lähtöjä 0 ja 100.
  - HUOM: Erilliset asetukset eri lähdöille eivät ole mahdollisia, tämän kehitys on suunnitelmissa. [Katso issue #16](https://github.com/jisotalo/shelly-porssisahko/issues/16)

## [2.8.2] - 25.11.2023
- Lisätty laitteen nimi myös sivun otsikkoon (selaimen otsikkopalkkiin)
- Parannettu checkboxien käytettävyyttä (voi klikata myös tekstejä, nyt kun on vapaata muistia)

## [2.8.1] - 24.11.2023 (2)
- Jos laittelle ei ole annettu nimeä, näytetään nimen tilalla "Ei asetettu"
- Päivitetty kääntämisprosessia

## [2.8.0] - 24.11.2023
- Uusi ominaisuus: Laitteen nimi näytetään tilasivulla
  - Asetetaan Shellyn omista asetuksista
- Uusi ominaisuus: käyttäjän oma funktio / ylikirjoitus
  - Käyttäjä voi lisätä skriptin loppuun oman funktion `USER_OVERRIDE`, joka ajetaan ennen ohjausta
  - Tällä voidaan tehdä omia ohjauksen lisäehtoja tai esimerkiksi lämpötilaohjaus
  - Katso esimerkit: [https://github.com/jisotalo/shelly-porssisahko/#lisätoiminnot-ja-omat-skriptit](https://github.com/jisotalo/shelly-porssisahko/#lisätoiminnot-ja-omat-skriptit)
- Uusi ominaisuus: asetusten määrity skriptistä
  - Skriptin asetukset voidaan määrittää ilman web-käyttöliittymää skriptistä
  - Käyttäjä voi lisätä oman funktion `USER_CONFIG`, joka muuttaa asetukset
  - Mahdollistaa asetukset muuttamisen esim. Shellyn pilvipalvelun kautta (skriptiä editoimalla)
  - Katso esimerkki: [https://github.com/jisotalo/shelly-porssisahko/#esimerkki-asetukset-suoraan-skriptiin-ilman-käyttöliittymää](https://github.com/jisotalo/shelly-porssisahko/#esimerkki-asetukset-suoraan-skriptiin-ilman-käyttöliittymää)

## [2.7.2] - 10.11.2023
- Bugikorjaus: Hintojen haku ei toiminut klo 00-02 välillä
  - Aikavyöhykkeen selvityksen toteutus muutettu järkevämmäksi
- Bugikorjaus: Jos aikavyöhykevalinnasta johtuen hintoja ei saatu koko vuorokaudeksi (alle 24 tuntia), skripti ei toiminut oikein
  - Todennäköisesti ei vaikutusta, sillä kaikki toimi Suomen/Viron aikavyöhykkeillä

## [2.7.1] - 09.11.2023
- Muutos/korjaus: Jos käsiohjaus, ei välitetä onko hintatiedot tai kellonaika OK - totellaan vain käsiohjausta
- Bugikorjaus: Jos kellonaika ei ollut tiedossa skriptin käynnistyessä, ohjaus ei toiminut heti (vaan vasta kun kellonaika saatiin tai tunti vaihtui)

## [2.7.0] - 05.11.2023
- Uusi ominaisuus: automaattinen aikavyöhyke (eli myös autom. kesä/talviaika)
  - Shelly laskee aikaeron UTC-ajan ja paikallisen ajan välillä -> Käytetään aina oikeaa aikavyöhykettä hintojen haussa
  - Jos aikaero muuttuu, haetaan hinnat uusiksi (esim. kun kesä/talviaika vaihtuu)
  - Lisätiedot: [Issue #7](https://github.com/jisotalo/shelly-porssisahko/issues/7)
- Firmware-vaatimus on 1.0.7. Vanhemmille ei luvata tukea.
  - Tässä firmisversiossa parannettiin skriptien muistinhallintaa

## [2.6.1] - 29.10.2023
- Bugikorjaus: Pikainen paikkaus jotta toimii kellojen siirron jälkeen
  - Koodiin on valitettavasti unohtunut kiinteä aikavyöhyke
  - Muutettu kiinteä aikavyöhyke +03:00 -> +02:00 väliaikaisesti
  - Parempi ratkaisu työn alla (joka hoitaa tämän automaattisesti)

## [2.6.0] - 23.10.2023
- Lisätty uusi ominaisuus: päivän keskiarvon käyttö hintarajana
  - Jos syöttää mihin tahansa seuraavista kentistä arvon `avg`, käytetään päivän keskiarvoa kiinteän arvon sijaan
    - **käsiohjaus**: hintaraja
    - **jakson halvimmat tunnit**: aina päällä -raja, maksimihinta

## [2.5.1] - 21.10.2023 (2)
- Bugikorjaus: Jos asetti pakko-ohjauksen x tunniksi painikkeella, se kyllä toimi, mutta tuli virheilmoitus

## [2.5.0] - 21.10.2023
- Lisätty uusi asetus: maksimihinta 
  - Ohjaustapaan **jakson halvimmat tunnit**
  - Jos hinta on yli asetetun rajan, lähtöä ei laiteta päälle (vaikka olisi halvimpia tunteja)
- Asetettu minimi- ja maksimirajojen vakioarvot -999 ja 999 c/kWh
  
## [2.4.0] - 19.10.2023
- Lisätty uusi asetus: Perättäiset tunnit
  - Valitaan perättäiset tunnit siten että hinnan keskiarvo on mahdollisimman alhainen
- Kasvatettu ohjaushistoria 12->24h
- Bugikorjaus: Tilasivulta saattoi vahingossa pystyä painaan asetussivun painikkeita

## [2.3.1] - 18.10.2023
- Optimoitu paljon muistin käyttöä
  - Lisää tilaa tuleville ominaisuuksille
  - Poistettu animaatioita ja muita karkkeja käyttöliittymästä tilan aikaansaamiseksi

## [2.3.0] - 17.10.2023
- Lisätty uusi asetus: käänteinen ohjaus
  - Jos ruksittu, relelähtö on aina päinvastainen kuin normaalisti
- Optimoitu muistin käyttöä

## [2.2.0] - 13.10.2023
- Lisätty uusi ominaisuus: pakko-ohjatut tunnit
  - Voi pakottaa että ohjaus on päällä aina tiettyinä tunteina
  - Kiitos ideasta petri1973 ([issue #4](https://github.com/jisotalo/shelly-porssisahko/issues/4))
- Parannettu toimintaa ongelmatilanteissa
- Optimoitu muistin käyttöä
  - Vanhat varmuustunti-asetukset katoavat päivityksen yhteydessä
  - Kommentoitu lokituksia pois shelly-koodista toistaiseksi
- Bugikorjaus: Jos hintojen luku epäonnistui, skripti kaatui
- Bugikorjaus: Korjattu varmuustuntien toiminta

## [2.1.0] - 12.10.2023
- Lisätty asetussivulle kaksi nappia
  - Pakko-ohjaus (lähdön voi pakottaa päälle x tunniksi - ei väliä onko hinta kallis vai halpa)
  - Linkki Shellyn hallintapaneeliin
- Otettu `Access-Control-Allow-Origin` vakiona pois käytöstä tietoturvan vuoksi
  - Paikallinen käyttöliittymäkehitys ei onnistu ilman tätä
  - Kehitystä ja API:n muualta käyttöä varten rivi pitää kommentoida käyttöön `src/shelly-porssisahko.js`-tiedostosta
- README päivitetty

## [2.0.1] - 10.10.2023
- Bugikorjaus: Käsiajon ohjauksen ja hätätilaohjauksen muuttaminen ei toiminut

## [2.0.0] - 10.10.2023
- Versio 2 julkaistu (tehty täysin uusiksi)
