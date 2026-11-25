# Finansradar

Norsk nettleserapp for dagsbaserte kjøps- og salgssignaler, historisk testing og simulert handel. Åpne `docs/index.html` i Chrome for å prøve appen med fiktive kurser. Den selvstendige HTML-fila fungerer uten installasjon.

## Bruk GitHub til å hente kurser

1. Opprett et privat GitHub-repository og legg hele mappa inn på standardgrenen. Ta med den skjulte mappa `.github`. Hvis du laster opp via nettleseren og mappa blir utelatt, oppretter du fila `.github/workflows/marked.yml` med **Add file → Create new file** og limer inn innholdet fra fila i ZIP-pakken.
2. På GitHub åpner du **Actions → Hent markedskurser → Run workflow**. Rediger listen med børssymboler, for eksempel `EQNR.OL,DNB.OL,KOG.OL,MSFT`, og velg 1, 2 eller 5 års historikk. Valutasymboler som `EURUSD=X` kan også brukes hvis Yahoo Finance har historikken.
3. Når kjøringen er ferdig, åpner du den og laster ned **Finansradar-marked** under **Artifacts**. Pakk ut arkivet og åpne `Finansradar.html`. Kurser og grafer ligger allerede i fila. Du kan også importere `kurser.json` i den HTML-fila du bruker fra før.

Bruk samme HTML-filplassering i Chrome og importer ny `kurser.json` når du vil videreføre de simulerte kontoene. Eksempelkontoene og kontoene med importerte eller hentede kurser er separate. Ordreloggen lagres i nettleseren når den tillater lokal lagring. Hver valuta har sin egen saldo, og startkapitalen låses i kontoen ved første handel.

### Valgfritt nettlesergrensesnitt på GitHub Pages

Under **Settings → Pages** velger du **Deploy from a branch**, standardgrenen og **/docs** hvis GitHub-abonnementet støtter Pages for repoet. Siden starter med eksempeldata. Importer `kurser.json` fra Actions eller din egen CSV i siden. Importen leses lokalt i nettleseren. GitHub Pages er normalt offentlig, også for private repoer der funksjonen er tilgjengelig. Repository og rapportartefakter kan holdes private ved å bruke Actions og åpne HTML-fila lokalt.

## Regler for historisk test

- Kjøp vurderes når kort glidende gjennomsnitt krysser over det lange og RSI er innenfor valgt intervall. Et kryss ned gir salgssignal. Standard er SMA 20/50, RSI 14 med intervallet 50–70 og ATR 14.
- Signaler bygger på sluttkurs. Historisk test handler tidligst ved neste åpning innenfor valgt periode. ATR-stop settes ved kjøpet. Åpner markedet forbi stoppen, bruker testen åpningskursen. Treffer dagslav stoppen innenfor dagen, bruker testen stopprisen.
- Størrelsen styres av stoppris, kurtasje og valgt risiko som andel av startkapitalen. Testen tillater brøkdeler og avgrenser kjøpet til tilgjengelig saldo. Hvert instrument testes for seg og sammenlignes med kjøp og behold i samme valuta. Testen tar med prosentvis kurtasje, men beregner ikke utbytte, skatt, valutaveksling eller ekstra kurspåslag.
- Kurshenting velger tidligere avsluttede kalenderdager i børsens lokale tidssone. Sjekk datoen i signaltabellen. I simulert handel registreres ordren manuelt til den viste sluttkursen, med valgt kurtasje.

## Egen kursfil

CSV trenger dato, symbol, åpningskurs, høyeste, laveste, sluttkurs og valuta. Bruk én rad per instrument og dato. Ved semikolon som skilletegn kan du bruke desimalkomma.

```csv
date,symbol,open,high,low,close,currency
2025-04-22,MITT,100,103,99,102,NOK
2025-04-23,MITT,102,104,101,103,NOK
```

## Bygg lokalt

```sh
python3 scripts/build.py
python3 -m pip install -r requirements.txt
python3 scripts/fetch_prices.py --symbols=EQNR.OL,MSFT --period=2y --output=rapport/kurser.json
python3 scripts/build.py --data=rapport/kurser.json --output=rapport/Finansradar.html
```

Kurshenteren bruker yfinance og Yahoo Finance for personlig bruk. Den kan få feil fra leverandøren. Ugyldige symboler eller manglende data vises som merknader så lenge minst ett instrument kunne hentes.

[GitHub Actions](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) · [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [yfinance](https://github.com/ranaroussi/yfinance)
