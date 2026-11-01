# Vertailu alkuperäiseen versioon 3.4.0

Tämä dokumentti kuvaa, miten muokattu versio 10.0.0 eroaa alkuperäisestä versiosta 3.4.0 teknisesti: muistin käyttö, suoritusajat, tietorakenteet ja virheiden käsittely. Käyttäjälle näkyvät muutokset ovat [CHANGELOG.md](../CHANGELOG.md)-tiedostossa.

Lähdekoodissa muutoskohdat on merkitty kommentilla, joka alkaa `v10:`.

## Tiivistelmä

- **Muisti:** muistissa oleva hintatieto on nelinkertainen (96 varttihintaa päivässä 24 tuntihinnan sijaan), ja lepokäyttö on silti noin 0,7 kilotavua pienempi. Hintahaun huippu on samoilla asetuksilla noin 0,8 kilotavua korkeampi, mutta alkuperäisen suurin huippu syntyi asetusten tallennuksessa, joten version 10.0.0 suurin huippu on noin 0,9 kilotavua pienempi (20,1 kilotavua, alkuperäisessä 21,0). Historia vie murto-osan alkuperäisestä (täysi historia noin 0,4 kilotavua, alkuperäisessä noin 6 kilotavua). Uuden asennuksen oletus, yksi ohjaus, käyttää selvästi vähemmän muistia kuin alkuperäinen.
- **Suoritusaika:** tuntiohjauksen logiikan suoritusaika on noin kolmasosa alkuperäisestä. 15 ja 30 minuutin tarkkuudella logiikan ajo kestää noin 0,6 sekuntia.
- **Toiminta tuntitarkkuudella** on sama kuin alkuperäisessä. Tämä on varmistettu ajamalla molempia versioita simulaattorissa rinnakkain satunnaisilla hinnoilla ja asetuksilla.
- **Virhetilanteet:** asetusten tai hintadatan virhe ei enää pysäytä skriptiä, ja aiemmin haetut hinnat pysyvät käytössä hintahaun epäonnistuessa.

## Mittausten tausta

| | |
|---|---|
| Laite 1 | Shelly Outdoor Plug S Gen3, laiteohjelmisto 2.0.1 |
| Laite 2 | Shelly Pro 2 (Gen 2), laiteohjelmisto 2.0.1 |
| Laite 3 | Shelly 1 Gen4, laiteohjelmisto 2.0.1 |
| Skriptimuistin koko | 25 186 tavua kaikissa |
| Tilanne | kahden päivän hinnat muistissa, ellei toisin mainita |

Luvut ovat yksittäisiä mittauksia tai muutaman ajon vaihteluvälejä, eivät tilastollisia keskiarvoja. Muistiluvut on luettu Shellyn komennolla `Script.GetStatus` (`mem_used`, `mem_peak`). Kilotavu on tässä 1000 tavua, ei 1024. Alkuperäisen version luvut on mitattu Gen 3 -laitteella.

## Muistin käyttö

Kolmen ohjauksen vertailu on mitattu samalla Gen 3 -laitteella (Shelly Outdoor Plug S) samoilla asetuksilla peräkkäin: kolme ohjausta käytössä, historia 24 riviä ohjausta kohden (versiossa 10.0.0 asetus 72 riviä), kolme käynnistystä kummallakin versiolla. Luvut on luettu heti käynnistyksen jälkeen, kun molempien päivien hinnat ovat muistissa ja historia on vielä lähes tyhjä. Yhden ohjauksen luvut ovat viikon yhtäjaksoisesta ajosta Gen 3- ja Gen 4 -laitteella (luvut samat).

| Tilanne | 3.4.0 | 10.0.0 |
|---|---|---|
| Lepokäyttö, kolme ohjausta | 9,8 kt | 9,1 kt |
| Huippu hintahaussa, kolme ohjausta | 19,3 kt | 20,1 kt |
| Huippu asetusten tallennuksessa, kolme ohjausta | 21,0 kt | ei nosta huippua |
| **Suurin huippu**, kolme ohjausta | **21,0 kt** (asetusten tallennus) | **20,1 kt** (hintahaku) |
| Suurin huippu, kun vastauksessa on Cloudflaren lisäotsakkeet | noin 23 kt | noin 22 kt |
| Lepokäyttö ja huippu, yksi ohjaus (uuden asennuksen oletus) | - (aina kolme ohjausta) | 7,1-8,0 kt ja 18,4-18,6 kt |
| Yhden päivän hinnat | noin 2,1 kt (24 tuntihintaa) | noin 0,5 kt (96 varttihintaa) |
| Yksi historiarivi | 84 t | noin 6 t |
| Täysi historia, 72 riviä | noin 6 kt | noin 0,4 kt |
| Yksi ohjaus | noin 0,6 kt | noin 0,7 kt |

Lukemat toistuivat käynnistyksestä toiseen lähes tavun tarkkuudella. Asetusten tallennus on mitattu samalla asetelmalla kuin asetussivu sen tekee: arvo tallennetaan ja skriptiä pyydetään lataamaan asetukset. Alkuperäinen hakee silloin hinnat uudelleen, kun molempien päivien hinnat ovat jo muistissa, joten tallennus on sen suurin huippu. Versio 10.0.0 ei hae hintoja tallennuksen yhteydessä. Lisäotsakkeiden huippu on laskettu: suurin huippu + noin 2 kilotavua, sillä vastaus on molemmille sama.

Huippua ei voi laskea suoraan lepokäytöstä, koska huipun hetkellä huomisen hintoja ei vielä ole muistissa: huippu on lepokäyttö miinus huomisen hinnat plus hintahaun vastaus (noin 11,5 kilotavua, sama molemmille). Alkuperäisessä huomisen hinnat vievät noin 2,1 kilotavua, versiossa 10.0.0 noin 0,5 kilotavua. Siksi versio 10.0.0 on levossa pienempi mutta haun hetkellä suurempi: sen muu muisti (ohjelma ja tila) on noin 0,9 kilotavua suurempi, ja pakatut hinnat kompensoivat sen levossa.

Historia kasvattaa molempia lukuja ohjausten kytkeytyessä. Täydellä historialla alkuperäinen käyttää noin 6 kilotavua enemmän, versio 10.0.0 noin 0,4 kilotavua enemmän, joten käytössä olevalla laitteella versio 10.0.0 vie selvästi vähemmän muistia.

### Mistä huippu syntyy

Huipun määrää Shellyn suorittaman HTTP-pyynnön vastaus, ei skriptin oma data. Kun `HTTP.GET` palaa, muistissa ovat yhtä aikaa vastauksen sisältö base64-muodossa (noin 5 kt) ja kaikki vastauksen otsakkeet (noin 1,8 kt). Skripti vapauttaa otsakkeet ensimmäiseksi ja purkaa sisällön 256 merkin paloina, mutta lähtötasoon se ei voi vaikuttaa. Vastaus on molemmissa versioissa sama.

### Vaihteleva huippu: Cloudflaren ylimääräiset HTTP-otsakkeet

Elering-rajapinta on Cloudflaren takana. Cloudflare lisää osaan vastauksista ylimääräisiä HTTP-otsakkeita raportointia varten (`Content-Security-Policy-Report-Only`, `Reporting-Endpoints` ja pidempi `Report-To`), jolloin otsakkeet pitenevät selvästi. Hintadata on sama. Lisäotsakkeet tulevat satunnaiseen osaan vastauksista kaikilla Shelly-malleilla. Cloudflare jättää ne pois pyynnöistä, jotka se tunnistaa automaattiseksi liikenteeksi, mutta Shellyn pyyntöjä se ei tunnista sellaiseksi. Kaikkien sukupolvien Shellyt tekevät pyynnön samalla tavalla (ks. [Sukupolvien erot](#sukupolvien-erot)), ja Shellyn kaltaisella pyynnöllä otsakkeet tulivat mallinimestä riippumatta. Esimerkiksi `curl` oletusasetuksillaan tunnistetaan automaattiseksi liikenteeksi, eikä se saa lisäotsakkeita. Hintahaun tilastot (`s.fH`, `s.fPk`, `s.fPkH`) näyttävät, milloin näin on käynyt.

Tällöin muistihuippu on noin 2 kilotavua tavallista korkeampi (Pro 2, kolme ohjausta: mitattu 21,8 kilotavua). Ilmiö koskee samalla tavalla alkuperäistä versiota. Skripti ei voi vaikuttaa tähän, koska Shellyn hakukomennossa ei ole valintaa otsakkeiden jättämiseksi pois.

Muistin riittävyyttä kannattaa siis arvioida tämän huipun mukaan: yhdellä ohjauksella noin 20,6 kilotavua, jolloin 25,2 kilotavun rajaan jää noin 4,6 kilotavua, ja kolmella ohjauksella noin 22 kilotavua, jolloin jää noin 3 kilotavua. Lisäosaversioissa huippu on noin 0,6 kilotavua korkeampi.

## Suoritusajat

| | 3.4.0 (Gen 3) | 10.0.0 (Gen 3) | 10.0.0 (Gen 2) |
|---|---|---|---|
| Hintojen jäsennys, yksi päivä | 1 931 ms | 1 333 ms | 1 320 ms |
| Logiikka, tuntitarkkuus, halvimmat tunnit | 418 ms | 114-120 ms | 137-139 ms |
| Logiikka, tuntitarkkuus, peräkkäiset | 284 ms | 110 ms | 139 ms |
| Logiikka, 15 tai 30 min, halvimmat tai peräkkäiset | ei ole | 620-684 ms | 600-672 ms |
| Logiikka, 15 tai 30 min, hintaraja | ei ole | 86-90 ms | 95 ms |

- Jäsennysaika ei sisällä tilastojen (keskihinta, halvin, kallein) ja tuntihintojen laskentaa, joka tehdään versiossa 10.0.0 erikseen pääsilmukassa (noin 450 ms).
- 15 ja 30 minuutin tarkkuudella aika kuluu 96 hinnan purkamiseen pakatusta muodosta, ei itse valintaan. Siksi 30 minuutin tarkkuus ei ole 15 minuutin tarkkuutta nopeampi.
- Alkuperäisen lajitteluun perustuva halvimpien valinta olisi vienyt 96 hinnalla noin 2,7 sekuntia (mitattu erillisellä koeskriptillä), joten varttiohjaus edellytti uutta valintatapaa.

## Tietorakenteet

### Hinnat

| | 3.4.0 | 10.0.0 |
|---|---|---|
| Muoto | taulukko rivejä `[aikaleima, hinta]` | pakattu merkkijono, 3 tavua per jakso |
| Sisältö | tunnin keskihinta, ALV ja siirtomaksu mukana | jokaisen 15 minuutin jakson raakahinta (0,01 EUR/MWh) |
| Aikatieto | jokaisella rivillä | päivän alkuhetki `_.s.p[x].st` ja jakson pituus `_.s.p[x].sl` |
| ALV ja siirtomaksut | lisätään jäsennettäessä | lisätään luettaessa (`calcPrices`) |
| Siirtomaksun valinta | päivämaksu joka päivä klo 07-22 | aikasiirto kuten ennen tai kausisiirto (päivämaksu 1.11.-31.3. ma-la); päivät ja kellonajat ovat asetuksia. Valinta tehdään kerran hintapäivää kohti |

- Tämän päivän tuntihinnat pidetään välimuistissa (`hourly`), jotta tuntiohjauksen logiikan ei tarvitse purkaa hintoja joka ajolla.
- Tilastot ja tuntihinnat lasketaan vain pääsilmukasta (`statsReq`), ei koskaan vastauskäsittelijöiden sisältä. Syy on Gen 2 -laitteiden pieni kutsupino, ks. [Sukupolvien erot](#sukupolvien-erot).

### Miksi pakattu merkkijono

Välivaiheessa hinnat olivat kokonaislukutaulukossa. Shellyn tulkki tallentaa kokonaisluvun noin 15 tavuun vain, jos se on välillä -8192...8191. Suuremmat luvut ja liukuluvut vievät noin 29 tavua. Hinnat sadasosina (EUR/MWh x 100) ylittävät rajan noin 82 EUR/MWh:n kohdalla, jolloin taulukon koko olisi kaksinkertaistunut kalliina päivinä. Pakatussa merkkijonossa koko on aina sama.

### Historia

| | 3.4.0 | 10.0.0 |
|---|---|---|
| Muoto | taulukko rivejä `[aikaleima, ohjaus, tila]` | pakattu merkkijono, 4 tavua per rivi |
| Aika | sekunnin tarkkuus | minuutin tarkkuus (minuutit hetkestä `CNST.HIST_T0`) |
| Pituus | 24 riviä (rakennusvakio) | asetus 0-96 riviä |

Jos rivi kirjataan ennen kuin laite on saanut kellonajan, laitteen kello voi näyttää mitä tahansa, joten sitä ei käytetä. Aikakenttään tallennetaan sen sijaan minuutit laitteen käynnistyksestä, koska laite tietää ne aina.

- Rivit pysyvät oikeassa järjestyksessä keskenään, vaikka niitä kertyisi useita ennen kellonajan saamista (esimerkiksi pitkän verkkokatkon aikana).
- Arvo on aina pieni verrattuna oikeaan aikaleimaan, joten nämä rivit asettuvat historian vanhimmiksi, eli oikeaan kohtaan: ne on kirjattu ennen kaikkia rivejä, joilla on kellonaika.
- Käyttöliittymä tunnistaa pienen arvon ja näyttää ajan muodossa `00.00.0000 00:00`.

### Valinta-algoritmit

- **Halvimmat tunnit:** jakson lajittelun tilalla lasketaan, montako jakson hintaa on nykyistä halvempia (tasatilanteessa aiempi on halvempi). Tulos on sama kuin lajittelulla.
- **Peräkkäiset tunnit:** jokaisen ikkunan summan laskemisen tilalla liukuva summa. Tulos voi poiketa vain, jos kahden ikkunan summa on täsmälleen sama.
- **Hinnan tarkkuus:** sama valintalogiikka ajetaan tunti-, puolituntis- tai varttihinnoilla. Tuntimäärä kerrotaan hintojen määrällä tunnissa ja pyöristetään kokonaisiksi hinnoiksi.
- **Kellonsiirtopäivät:** jaksojen rajoista vähennetään ensimmäisen hinnan kellotunti laitteen nykyisellä aikavyöhykkeellä, jotta rajat osuvat kellonaikoihin kellonsiirron jälkeen. Kello 00 alkava jakso alkaa aina päivän ensimmäisestä hinnasta ja kello 24 päättyvä päättyy viimeiseen, joten 24 tunnin jakso kattaa myös 25 tunnin päivän eikä valinta muutu kellonsiirron hetkellä.

### Hintojen jäsennys

- Base64 puretaan 256 merkin paloina ja rivit käsitellään sitä mukaa kuin ne valmistuvat, joten koko CSV ei ole kerralla muistissa.
- Rivit rajataan pyydettyyn päivään CSV:n päivämääräsarakkeen perusteella. Shelly tuntee vain nykyisen aikavyöhykkeen, joten kellonsiirtopäivänä pyynnön aikaväli voi olla tunnin sivussa.
- Rivien pitää olla järjestyksessä ja tasavälein. Puuttuva jakso saa saman vastauksen edellisen jakson hinnan. Muuten virheellinen vastaus hylätään kokonaan.
- Nykyiset hinnat korvataan vasta, kun uudet on saatu kokonaan ja todettu kelvollisiksi.

### Vaikutus ulkoisiin skripteihin

| Kohde | Muutos |
|---|---|
| `_.p` | pakattu merkkijono (ennen rivitaulukko) |
| `_.h` | pakattu merkkijono (ennen rivitaulukko) |
| `_.s.p[x]` | uudet kentät `st` ja `sl`; `now`, `avg`, `low`, `high` ja `ts` ennallaan |
| `_.s` | uudet kentät `errTot`, `errT0`, `errT1`, `errN`, `fB`, `fH`, `fPk`, `fPkTs` ja `fPkH` |
| `_.si[x]` | uusi kenttä `oe` (lähtö, jota laitteessa ei ole) |
| `_.c.c` | uudet asetukset `cnt` ja `hist` |
| `_.c.i[x]` | uusi asetus `q`; `m2.c` ja `m2.c2` voivat olla desimaalilukuja |
| `?r=s` | `p` on kaksi base64-merkkijonoa, uusi kenttä `t` (laitteen aika); ohjaukselle, jota ei ole, palautetaan vain `s` ja `c`. Purkufunktiot ulkoiselle ohjelmalle: [unpack.md](unpack.md) |
| `?r=h` | base64-merkkijono |
| `USER_CONFIG`, `USER_OVERRIDE`, `USER_LOOP` | ennallaan |

Mukana tulevat lisäosat eivät käytä muuttuneita rakenteita.

## Virheiden käsittely

| Tilanne | 3.4.0 | 10.0.0 |
|---|---|---|
| Käynnistys ilman kellonaikaa | hätätilaohjaus heti, hintaohjaus kytkee lähdön takaisin sekunteja myöhemmin | 3 min odotusaika kellonajalle ilman lähtöjen kirjoitusta (reitittimen käynnistyminen sähkökatkon jälkeen), sen jälkeen hätätilaohjaus |
| Hintahaku epäonnistuu | hinnat tyhjennetään, ohjaus varmuustunneilla | saman päivän aiemmin haetut hinnat pysyvät käytössä |
| Hintoja ei ole lainkaan ja haku epäonnistuu | varmuustunnit heti ensimmäisestä epäonnistumisesta | varmuustunnit kolmen peräkkäisen epäonnistumisen jälkeen (noin 15 s); sitä ennen lähtöön ei kosketa |
| Vuorokausi vaihtuu eikä haku onnistu | varmuustunnit | edellisenä päivänä haetut huomisen hinnat otetaan käyttöön |
| Uusintayritykset katkossa | 3 yritystä heti peräkkäin (0,5 s), 2 min tauko, toistuvasti | 3 yritystä noin 5 s välein, sitten yksi yritys 2 min välein kolmesti, sen jälkeen 10 min välein; onnistuminen, maan vaihto ja vuorokauden vaihtuminen aloittavat alusta |
| Vastaus on virhesivu tai virheilmoitus | koko vastaus kopioidaan lokiin (`JSON.stringify`), muisti voi loppua | lokiin vain vastauskoodi ja pituus |
| Vajaa tai epäjärjestyksessä oleva hintadata | hyväksytään, jos dataa on vähintään 23 tuntia | hylätään; yksittäiset puuttuvat jaksot täytetään edellisellä hinnalla |
| Rikkinäinen JSON asetuksissa | skripti pysähtyy | aiemmat asetukset pysyvät voimassa |
| Väärän tyyppinen arvo asetuksissa | skripti pysähtyy tai jää jumiin | korvataan oletuksella tai aiemmalla arvolla |
| Lähtö, jota laitteessa ei ole | yritetään 10 s välein, muut ohjaukset eivät etene | varoitus, muut ohjaukset toimivat |
| Asetusten latauspyyntö, kun skriptin suoritus on aktiivinen | pyyntö hukkuu (503) | pyyntö jää jonoon |
| Kello hyppää yli 5 minuuttia | hinnat haetaan uudelleen | sama, lisäksi virhetauko nollataan |
| Hintahaun hetki klo 15 ja keskiyöllä | ensimmäisellä kierroksella tasatunnin jälkeen (0-10 s) | laitekohtaisella viiveellä 3-5 min (180-300 s) MAC-osoitteesta; käynnistyessä ja asetusten muuttuessa heti |
| Hintakatko jatkuu | logiikka ja lähdöt ajetaan uudelleen jokaisen epäonnistuneen haun jälkeen | logiikka ajetaan vain varmuustuntien alkaessa ja tasatunneilla |

Hintahaun virheistä pidetään laskuria (`_.s.errTot`, ensimmäinen `_.s.errT0`) ja viimeisimmästä katkosta alkua, viimeistä virhettä ja määrää (`_.s.errT1`, `_.s.errTs`, `_.s.errN`). Ne näkyvät historiasivulla. Laskuri on vain työmuistissa ja nollautuu skriptin käynnistyessä.

Hintahaun vastauksesta kirjataan bodyn ja HTTP-otsakkeiden pituus (`_.s.fB`, `_.s.fH`). Jos skriptin muistihuippu nousee haun aikana, kirjataan uusi huippu, haun aika ja sen otsakkeiden pituus (`_.s.fPk`, `_.s.fPkTs`, `_.s.fPkH`). Näin näkee jälkikäteen, johtuuko huippu hintadatasta vai Cloudflaren ylimääräisistä otsakkeista (ks. [Vaihteleva huippu](#vaihteleva-huippu-cloudflaren-ylimääräiset-http-otsakkeet)). Kentät ovat tilavastauksessa (`?r=s`) eivätkä näy käyttöliittymässä.

## Sukupolvien erot

Sama skripti toimii Gen 2-, Gen 3- ja Gen 4 -laitteissa, ja skriptimuistin koko on kaikissa sama 25 186 tavua. Laitteilla on havaittu yksi ero, joka vaikuttaa koodin rakenteeseen:

**Gen 2 -laitteissa kutsupinoa on `Shelly.call`-vastauskäsittelijöiden sisällä selvästi vähemmän kuin Gen 3:ssa.** Ketju asetusten haun vastauskäsittelijä -> `chkConfig` -> sisäkkäinen takaisinkutsu -> `updStats` -> `calcPrices` pysäytti skriptin Shelly Pro 2:lla virheeseen "Too much recursion - the stack is about to overflow". Sama koodi toimi Gen 3 -laitteella. Pääsilmukasta (ajastimesta) käynnistettynä sama laskenta toimi vielä kuudella ylimääräisellä kutsutasolla.

Tästä syystä raskas laskenta tehdään vain pääsilmukasta: vastauskäsittelijä asettaa pyynnön (`statsReq`), ja silmukka laskee. Pinon ylivuotoa ei voi ottaa kiinni `try/catch`-rakenteella, eikä simulaattori havaitse sitä, joten muutokset kannattaa ajaa myös Gen 2 -laitteella (ks. laitetesti, [test/README.md](../test/README.md)).

Muita laitteilla havaittuja tulkin ominaisuuksia, jotka simulaattori ei toista:

- `JSON.stringify` antaa virheen "Invalid UTF-8 string", jos merkkijonossa on tavuja, jotka eivät ole kelvollista UTF-8:aa.
- Lokirivi katkaistaan 128 merkkiin.
- Kun skripti kaatuu muistin loppumiseen, osa skriptimuistista voi jäädä varatuksi laitteen uudelleenkäynnistykseen asti. Pelkkä skriptin uudelleenkäynnistys ei vapauta sitä, joten kaatumisen jälkeen laite kannattaa käynnistää kokonaan uudelleen ennen kuin skripti käynnistetään tai muistia mitataan.
- `Date` ei tunne kesäaikasääntöjä: se käyttää kaikille päivämäärille laitteen nykyistä aikavyöhyke-eroa.

Laitteen HTTP-pyynnöt ovat kaikissa sukupolvissa samanlaiset (laiteohjelmisto 2.0.1):

- User-Agent on muotoa `<malli>/<laiteohjelmisto> (ShellyOS)`, esimerkiksi `OutdoorPlugSG3/2.0.1 (ShellyOS)` (Outdoor Plug S Gen3), `S1G4/2.0.1 (ShellyOS)` (Shelly 1 Gen4) ja `Pro2/2.0.1 (ShellyOS)` (Pro 2). Skripti ei voi vaihtaa sitä: `HTTP.Request` korvaa annetun User-Agentin laitteen omalla, mutta muut otsakkeet (esimerkiksi `Accept`) menevät perille. Otsakkeet annetaan objektina.
- `HTTP.GET` lähettää otsakkeista vain `Host`- ja User-Agent-otsakkeen.
- Yhteys on TLS 1.2 ilman ALPN:ää eli HTTP/1.1, ja TLS-sormenjälki on kaikissa sukupolvissa sama.

## Suunnittelupäätökset

| Päätös | Perustelu |
|---|---|
| Hintalähteenä edelleen Eleringin CSV-rajapinta | toimii ilman rekisteröitymistä, ja vastaus on JSON-muotoa pienempi. Vastaus tulee Shellylle binäärinä (base64), mitä ei voi kiertää |
| Hintoja ei tallenneta KVS-muistiin | sähkökatkon jälkeen laitteella ei ole kellonaikaa ennen verkkoyhteyttä, joten tallennetuista hinnoista ei olisi silloin hyötyä |
| Huomisen hinnat pidetään laitteella | selain ei voi hakea niitä Eleringiltä itse (rajapinta ei salli selainhakuja muilta sivuilta), ja pakattuna ne vievät vain noin 460 tavua. Samalla ne toimivat varahintoina vuorokauden vaihtuessa |
| Yksi skripti, ei kahta | kaikki laitteen skriptit jakavat saman 25 kilotavun muistin, joten jakaminen ei toisi lisää tilaa |
| Ei sukupolvikohtaisia ominaisuuksia | sama skripti kaikille laitteille. Esimerkiksi tyypitetyt taulukot jätettiin pois |
| 15 minuutin logiikkaa ei nopeutettu enempää | vain nykyisen jakson laskeminen olisi lisännyt riskiä valintakoodin ytimeen eikä olisi auttanut oletusarvoista 24 tunnin jaksoa |
| Ohjauksia enintään kolme | Neljäs ohjaus olisi teknisesti mahdollinen, mutta se on jätetty tietoisesti pois, koska se veisi lähemmäs kahta rajaa:<br><br>- **muisti:** jokainen ohjaus lisää muistin lepokäyttöä ja muistihuippua noin 700 tavua<br>- **suoritusaika:** ohjaukset ajetaan peräkkäin, joten jakson vaihtuessa laite on varattuna pidempään<br><br>Asetusten tallennustila ei enää rajoita: yhteiset asetukset vievät kolmella ohjauksella pitkilläkin nimillä alle 100 tavua 253:sta. Kolme on myös alkuperäisen version enimmäismäärä.<br><br>Neljäs ohjaus olisi tietyin rajoituksin mahdollinen. Muistihuippu olisi silloin noin 20,8 kilotavua (Cloudflaren lisäotsakkeilla noin 22,8 kilotavua) skriptimuistin 25,2 kilotavusta ja sivun latauksen aikana enemmän, joten laitteessa ei voisi olla muita skriptejä, ja historian pituus kannattaisi pitää pienenä. |
| Asetukset tallennetaan arvojen listana omiin avaimiinsa | Shelly sallii KVS-arvolle 253 tavua mutta laskee jokaisen lainausmerkin kahtena (mitattu laiteohjelmistolla 2.0.1). Asetusten nimillä JSON-tekstinä ohjauksen asetukset olisivat pahimmillaan 303, eli ne eivät mahdu. Listana ilman nimiä pahin tapaus on 126, joten tilaa jää myös tuleville asetuksille. Uudet avaimet (`porssisahko`...) pitävät version 3.x asetukset (`porssi`...) koskemattomina, joten paluu vanhaan versioon toimii ilman muunnosta, eikä vanha versio voi kaatua muotoon, jota se ei tunne. Hintana käsin muokkaus on hankalampaa. |

## Tunnetut rajoitukset

- **Sähkökatko:** hintoja ei tallenneta pysyvästi. Katkon jälkeen hintaohjaus alkaa vasta, kun verkkoyhteys on palannut, kellonaika on saatu ja hinnat haettu. Siihen asti ohjaus on ensin hätätilaohjauksella (kellonaika ei tiedossa) ja sitten varmuustunneilla. Verkkoyhteyden toipuminen katkosta on siis toiminnan kannalta tärkeää.
- **Suuri virhevastaus:** Shelly antaa skriptille aina koko vastauksen kerralla. Hyvin suuri virhesivu voi viedä muistin ennen kuin skripti pääsee käsittelemään sitä.
- **Kellonsiirtopäivät:** yön tunteina ennen kellonsiirtoa laite ei vielä tiedä siirrosta, joten jaksojen rajat ja siirtomaksun päivä- ja yöraja voivat poiketa tunnilla. Kellonsiirron jälkeen rajat noudattavat kellonaikaa.
- **Historia:** rivit tallennetaan minuutin tarkkuudella, joten saman minuutin riveillä on sama kellonaika. Rivit näytetään tallennusjärjestyksessä, joten niiden keskinäinen järjestys on oikea.
- **Sivutiedostojen koko:** laite pitää selaimelle lähetettävän tiedoston muistissa lähetyksen ajan, joten yksittäinen tiedosto ei saa kasvaa niin suureksi, että sivun lataus nostaisi muistihuippua. Raja ja sen perustelu ovat testissä `test/memory.test.js`. Tästä syystä englanninkieliset käännökset on jaettu kahteen tiedostoon, ja sivu hakee ne yksi kerrallaan.
- **Lisäosan muuttamat asetukset voivat tallentua:** lisäosa, joka muuttaa asetuksia työmuistissa (esimerkiksi tuntimäärää lämpötilan mukaan), näkyy asetussivulla muutetuilla arvoilla, ja Tallenna kirjoittaa ne laitteen muistiin. Sama voi tapahtua kerran versiopäivityksen jälkeen, kun skripti täydentää puuttuvat asetukset. Ohjaukseen tällä ei ole vaikutusta, koska lisäosa asettaa arvot uudelleen joka latauksella; ero näkyy vasta, jos lisäosa poistetaan. Näin on toiminut alkuperäisestä versiosta asti.
- **Laitteen salasana:** kun laitteeseen on asetettu salasana, käyttöliittymä ei aukea iPhonella eikä iPadilla millään selaimella, eikä tietokoneella Safarilla. Kaikki iPhonen ja iPadin selaimet käyttävät Safarin selainmoottoria, joka ei tue laitteen käyttämää kirjautumistapaa (digest SHA-256). Laite vaatii kirjautumisen ennen kuin pyyntö päätyy skriptille, joten skripti ei voi tarjota omaa kirjautumissivua. Ohjaus ja HTTP-rajapinta toimivat salasanan kanssa. Näin on toiminut alkuperäisestä versiosta asti.

## Mitä ei ole todennettu laitteella

Nämä on testattu vain simulaattorissa:

- kesäaikaan siirtymisen päivä hintojen kanssa (tulevalle päivälle ei ole hintoja). Talviaikaan siirtyminen on todennettu kaikilla kolmella laitteella oikeilla hinnoilla viikon yhtäjaksoisessa ajossa
- lämpötila-antureita käyttävät lisäosat oikealla anturilla
- kolmen tai neljän lähdön laitteet

Alkuperäinen versio on tekijänsä mukaan käytössä useilla Gen 2 -laitteilla (Plus- ja Pro-sarjat), ja hän on mitannut sen muistin käytön Shelly Pro 3:lla. Tämän version päivitystesteissä alkuperäinen versio on ajettu myös Shelly Pro 2:lla (Gen 2) ja Shelly 1 Gen4:llä: käynnistys, asetukset ja hintahaku toimivat. Yllä olevat alkuperäisen muisti- ja suoritusaikaluvut on mitattu Gen 3 -laitteella.
