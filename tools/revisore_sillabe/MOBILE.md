# Uso da telefono, con PC spento

## Stato e scelta dell'hosting

Preparazione locale, NON pubblicazione. Checkpoint iniziale pulito:
`c24b3998f0e6c54eb2457bbd80a61c06fcd4449c`, branch main.
Il connettore GitHub ha confermato repository privato e permessi admin.
Non espone il piano dell'account; il browser non autenticato mostra 404
sulle impostazioni private. Questo NON prova che Pages sia indisponibile.
Per verificarlo personalmente, aprire il repository autenticati:
Settings > Pages, senza cambiare visibilita' o acquistare un piano.

GitHub Pages su repository privati richiede un piano abilitato; la shell
pubblicata sarebbe comunque pubblica. Non e' stato aggiunto un workflow
automatico che possa pubblicare al prossimo push.

Proposta: **Cloudflare Pages Free, Direct Upload**, senza collegare GitHub,
senza backend, CLI, dominio acquistato o PC acceso. Account Cloudflare
e disponibilita' del nome progetto devono essere verificati dall'autore.
Nessun account/servizio creato, nessuna prova di disponibilita' del nome.
Direct Upload accetta ZIP/cartella e permette aggiornamenti manuali della shell.
Non puo' essere convertito in progetto Git-integrated: richiederebbe un altro
progetto. Non serve questa integrazione per il revisore.

Riferimenti ufficiali verificati il 2026-10-02:
- [Disponibilita' GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).
- [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/).
- [Limiti piano Free](https://developers.cloudflare.com/pages/platform/limits/).
- [Web Analytics da NON abilitare](https://developers.cloudflare.com/pages/how-to/web-analytics/).

## Artefatto pubblicabile: solo nove file

Dalla radice del repository:

```powershell
python -B tools/revisore_sillabe/prepara_deploy.py `
  --output "$env:TEMP/revisore-shell-mobile-NUOVA-VERSIONE"
```

Scegliere una directory nuova **fuori dal repository**. Lo script non scarica,
non legge pacchetti/proposte e non pubblica nulla. Rifiuta output esistente.
La copia e lo ZIP sono controllati byte per byte rispetto ai sorgenti:

```text
site/ oppure revisore-shell.zip:
index.html
style.css
app.mjs
reviewer-core.mjs
db.mjs
manifest.webmanifest
service-worker.js
icon-192.png
icon-512.png
```

Solo questi file sono inclusi, anche se la directory sorgente contiene altro.
README, rapporti, preparatore, test e inventario NON vengono pubblicati.
`inventario-locale.json` e' separato da site/ e ZIP; tenerlo sul PC.
NON caricare la directory padre, l'intera tools/, il repository, i dati o
cartelle Downloads. Non aggiungere file dopo aver verificato lo ZIP.
Le stringhe dei tipi/schema presenti nei moduli sono codice, non decisioni.

## Pubblicazione manuale: fermarsi prima del pulsante finale

Questa fase non autorizza un deploy pubblico. Prima della pubblicazione
serve la conferma esplicita dell'autore. Le seguenti sono istruzioni,
non azioni gia' eseguite:

1. Accedere a [Cloudflare dashboard](https://dash.cloudflare.com/), con account
   Free. Registrazione/condizioni, se necessarie, devono essere completate
   dall'autore. Non acquistare un piano o dominio.
2. Workers & Pages > Create application > Get started > Drag and drop your files
   (se appare prima una scelta prodotto, scegliere Pages/Upload assets).
3. Nome proposto `revisore-sillabe-luccio`; non e' prenotato. Se occupato,
   scegliere un nome diverso e conservarlo per gli aggiornamenti.
4. Selezionare SOLTANTO `revisore-shell.zip` verificato, o la sua site/.
5. Controllare nove file, index.html alla radice, nessuna funzione/backend.
   Non abilitare Web Analytics, beacon, Zaraz, snippet o integrazione Git.
6. **FERMARSI prima di Deploy site / Save and Deploy** senza autorizzazione
   alla pubblicazione della sola shell. Questo pulsante rende pubblico il sito.
7. Dopo autorizzazione/pubblicazione, usare l'URL HTTPS di produzione
   comunicato dal dashboard. Forma prevista: `https://<nome-progetto>.pages.dev/`.
   Nessun URL reale e' stato ottenuto nella preparazione locale.

La shell diventera' pubblica; repository, lessico, evidenze, pacchetto,
curatela e decisioni NON sono nell'artefatto. Nessun upload automatico:
i file importati sono letti tramite picker e restano nel browser del telefono.
Il provider vede le normali richieste HTTP della shell (come ogni hosting),
non le decisioni. L'app non contiene analytics o telemetria.
Controllare anche sul sito pubblicato che non siano stati iniettati script
esterni: in caso contrario non importare i dati reali finche' non risolto.

## URL, sottodirectory e archivi locali

HTML/moduli/CSS/manifest/icone/SW usano riferimenti `./`.
Manifest id, start_url e scope sono `./`; il SW e' registrato accanto a index.
Alla radice lo scope e' `/`; sotto `/revisore/` e' `/revisore/`.
Usare l'URL con slash finale o index.html, non link a percorsi inventati.
Non serve Service-Worker-Allowed che estenda lo scope a tutto il dominio.
Il SW gestisce solo l'elenco esplicito della shell, non pacchetti o proposte.

IndexedDB schema1 e logica import/export rimangono invariati. La sessione del
PC NON si trasferisce da sola: localhost e HTTPS hanno origin diversi.
Anche preview URL, dominio nuovo, browser/profilo privato o PWA separata
possono avere archivi diversi. Su iPhone importare nella **PWA aperta dalla
Home**, non affidarsi al passaggio automatico dei dati dalla scheda Safari.
Conservare URL di produzione e browser/profilo. Non cambiare dominio per
ogni aggiornamento; non usare l'URL temporaneo di preview per la revisione.

## Trasferire i due file, senza rigenerarli

Sul PC esportare un backup aggiornato delle decisioni prima del trasferimento.
Trasferire manualmente il pacchetto reale **gia' usato**, 13704 record, e il
JSON `proposte_curatela_ufficiale` gia' esportato. Non rigenerare il pacchetto
e non cambiare la sua base Git per adeguarla al checkpoint del codice.
La base del backup deve corrispondere integralmente a quella del pacchetto.

Usare cavo, Quick Share/AirDrop se disponibili sui dispositivi, oppure cloud
personale/allegato scelto dall'autore. Un cloud/allegato e' un trasferimento
volontario a quel servizio, NON un upload del revisore. Se si vuole evitare
anche questo, usare cavo/trasferimento locale. Sul telefono salvare i file
in Downloads/File e scaricarli realmente: non lasciare solo segnaposti cloud.
I file originali sul disco del PC non vengono modificati.

## Android / Chrome

1. Aprire l'URL HTTPS di produzione in Chrome normale, non Incognito.
2. Attendere **App pronta offline**. Menu Chrome > Installa e crea scorciatoia
   > Installa, oppure Installa app/Aggiungi a schermata Home, secondo versione.
3. Aprire dall'icona Home; attendere ancora App pronta offline.
4. Importa pacchetto > selezionare il JSON da Downloads/File; attendere la
   conferma e verificare 13704 parole.
5. Sessione e backup > impostare autore > Ripristina decisioni > JSON del PC.
   Verificare il numero **effettivo** di decisioni (circa 105) e una parola nota.
6. Usare Prima non decisa; fare un export di controllo e conservarlo in File.
7. Chiudere/riaprire dall'icona e verificare che pacchetto e decisioni restino.
8. Fare la prova offline descritta sotto, inclusa esportazione locale.

[Procedura Chrome ufficiale](https://support.google.com/chrome/answer/9658361?co=GENIE.Platform%3DAndroid&hl=it).

## iPhone / Safari

1. Aprire l'URL HTTPS in Safari normale, non Navigazione privata.
2. Condividi (o menu pagina > Condividi) > Aggiungi alla schermata Home;
   attivare **Apri come app web**, se presente, quindi Aggiungi.
3. Aprire dall'icona Home e attendere App pronta offline.
4. In File salvare i due JSON in locale, per esempio Sul mio iPhone/Downloads;
   eventuali file iCloud devono essere scaricati prima della modalita' aereo.
5. Dentro la PWA: Importa pacchetto, poi Sessione e backup > Ripristina decisioni.
   Configurare l'autore; controllare numero decisioni e una parola nota.
6. Prima non decisa, export e chiusura/riapertura; verificare dove Safari/PWA
   salva il download o usare Condividi > Salva su File quando disponibile.
7. Eseguire la prova offline sotto. Non disinstallare la PWA, cancellare i dati
   del sito o cambiare profilo senza un backup verificato.

[Procedura Apple ufficiale](https://support.apple.com/guide/iphone/iphea86e5236/ios).
Installazione, picker/download, quota e persistenza dipendono dalla versione
iOS/browser. Non promettiamo trasferimento automatico Safari -> PWA ne'
storage permanente. IndexedDB puo' essere eliminato/evicted: export frequenti,
mai unica copia. Mantieni dati sul dispositivo e' una richiesta, non garanzia.

## Riprendere le decisioni del PC

Importare prima pacchetto, poi backup. Se incompatibile, fermarsi e scegliere
i file corretti, non cambiare hash/base per aggirare il controllo. In caso di
decisioni locali differenti leggere la conferma prima di sostituirle.
L'export contiene decisioni, non cursore/saltate/filtri/bozze del PC.
Prima non decisa permette di riprendere. Non e' merge nella curatela ufficiale.
Due dispositivi non sono sincronizzati; per questa fase lavorare con un solo
dispositivo alla volta e trasferire il backup piu' recente consapevolmente.

## Prova definitiva con PC spento

Prima esportare un backup delle decisioni importanti. Non fare una scelta
linguistica solo per collaudare: eventualmente modificare/revocare e ripristinare
una proposta di prova consapevole, senza toccare la curatela ufficiale.

Fase online, **nella PWA installata**:
1. Aprire, attendere App pronta offline, importare pacchetto e backup.
2. Verificare 13704 record, numero decisioni importate e una decisione nota.
3. Esportare un JSON, verificare che sia disponibile localmente e riapribile.
4. Chiudere completamente e riaprire: dati e sessione devono essere presenti.

Fase offline:
1. Spegnere il PC. Telefono in modalita' aereo, Wi-Fi disattivato (puo' restare
   acceso in modalita' aereo). Non lasciare una connessione alternativa.
2. Chiudere e riaprire dall'icona Home: shell, 13704 parole e decisioni presenti.
3. Navigare, fare una scelta esplicita di prova, attendere Salvato sul dispositivo.
4. Chiudere/riaprire e verificare la scelta. Esportare un backup JSON in File.
   La condivisione via rete puo' non funzionare offline: il download deve bastare.
5. Conservare il backup anche fuori dal telefono appena possibile.

Il test su HTTPS/telefono fisico e sulle circa 105 decisioni reali NON e' stato
eseguito dall'agente: nessun sito pubblico creato e nessun file reale importato
durante questa fase. Il collaudo locale viene riportato separatamente, senza
equipararlo a una certificazione Android/iOS.

## Aggiornare in futuro senza perdere IndexedDB

Esportare prima. Incrementare CACHE nel SW quando cambia un file shell,
rigenerare ZIP, verificare e usare **Create a new deployment** dello STESSO
progetto Cloudflare, previa autorizzazione. Non nuovo nome/origin ogni volta.
In Direct Upload gli aggiornamenti sono manuali, nessun push necessario.
Disabilitare/lasciare disabilitati Web Analytics e altri snippet anche in futuro.
La nuova shell attende: Aggiorna app la attiva senza salvataggi pendenti.
La pulizia tocca solo cache del revisore, mai IndexedDB. Non resettare il
database e non cambiare schema nelle normali pubblicazioni della shell.

## Test locali ripetibili

```powershell
python -B -m unittest discover -s tools/tests -p test_deploy_revisore.py -v
node --test tools/tests/reviewer-core.test.mjs
python -B -m unittest discover -s tools/tests -p test_prepara_revisione_mobile.py -v
```

IndexedDB: servire tools/ su porta separata, aprire tests/reviewer-db-browser.html.
Usa un database sintetico UUID, non la sessione reale del PC. Root/sottodirectory:
servire una copia dell'artefatto, non tutta la directory repository. Arrestare
il server e ricaricare per una prova offline locale; questa non e' HTTPS remoto.

### Risultati della preparazione, 2026-10-02

- 62 test Python passati, nessuno saltato: 55 preesistenti e 7 di deployment.
- 14 test JavaScript passati e controlli sintassi dei moduli/SW passati.
- 14 verifiche IndexedDB reale passate nel database UUID sintetico isolato.
- Artefatto locale di nove file: directory e ZIP corrispondono ai sorgenti.
  Nessun pacchetto, elenco lessicale, proposta, raw, README o test nel ZIP.
- Browser integrato su origine isolata `http://127.0.0.1:8767`: avvio shell
  sia alla radice sia sotto `/revisore/`. Importata **una parola sintetica**,
  autore COLLAUDO SINTETICO, decisione di prova 4 salvata.
- Server 8767 arrestato: riapertura sotto `/revisore/` con pacchetto e decisione
  conservati; scelta sintetica cambiata a 2 e salvata offline. Nuova apertura
  alla radice, sempre senza server, mostra la stessa sessione/decisione 2.
  Questo conferma che il SW non richiede il server per riaprire la shell.
- Download offline cliccato; il browser integrato non ha restituito l'evento
  download entro 10 secondi. File scaricato NON certificato; export/logica
  coperti dai test JS. Ripetere il download su Chrome/Safari del telefono.
- Nessuna origine HTTPS pubblicata, nessun test fisico Android/iPhone,
  nessuna importazione delle 105 decisioni reali. Non equivalgono al test locale.
- Server di collaudo arrestati; sessione reale PC/origin localhost:8765 intatta.

Preparato esternamente per la verifica storica:
`revisore-shell.zip` (archivio locale, non distribuito nel repository).
Caricare esclusivamente questo ZIP o la sua site/, previa autorizzazione.
