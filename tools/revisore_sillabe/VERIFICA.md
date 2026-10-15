# Prima implementazione del revisore: verifica

Data: 2026-10-02. Branch `main`, HEAD iniziale/finale
`8de2796fbad84a411d23a7563f55b9f2482044f7`.
Working tree iniziale pulita. Nessun file esistente modificato:
SHA-256 dei 52 file gia' tracciati tutti identici al controllo iniziale.
Nessun git add, commit, push o deploy.

## Architettura e file

Generatore Python offline, logica pura ESM, persistenza IndexedDB, UI statica
indipendente e service worker limitato all'app shell. Nessuna build/framework,
CDN o nuovo software installato. Le evidenze non fanno parte della PWA.

Creati:

```text
tools/prepara_revisione_mobile.py
tools/revisore_sillabe/index.html
tools/revisore_sillabe/app.mjs
tools/revisore_sillabe/reviewer-core.mjs
tools/revisore_sillabe/db.mjs
tools/revisore_sillabe/style.css
tools/revisore_sillabe/manifest.webmanifest
tools/revisore_sillabe/service-worker.js
tools/revisore_sillabe/icon-192.png
tools/revisore_sillabe/icon-512.png
tools/revisore_sillabe/README.md
tools/revisore_sillabe/VERIFICA.md
tools/tests/test_prepara_revisione_mobile.py
tools/tests/reviewer-core.test.mjs
tools/tests/reviewer-db-browser.html
tools/tests/reviewer-db-browser.mjs
```

File modificati preesistenti: **nessuno**. Non e' stato necessario cambiare
la pipeline v2, il suo manifesto o il suo rapporto.

## Formati e operazioni

| Aspetto | Implementazione |
| --- | --- |
| Pacchetto | Schema1, tipo pacchetto_revisione_sillabe; base v2, coda/intervallo, record compatti; testimoni, non raw |
| Provenienza | Hash manifesto/coda/curatela verificati; Git HEAD verificato rispetto alla curatela; niente revisione inventata |
| IndexedDB | Versione1; packages metadata, records per parola, decisions per parola, session current |
| Export | Schema1 proposte_curatela_ufficiale, UUID/base/sole decisioni; ordine originale del pacchetto |
| Autosalvataggio | Transazione immediata decisione+cursore/stato, attesa oncomplete prima di avanzare; note/autore/filtri persistiti |
| Motivazione | Nota non vuota ripulita, oppure Revisione manuale tramite revisore sillabico |
| SALTA | Stato locale delle non decise; non esportato; non equivale a DA_RIVEDERE |
| Modifica/revoca | Nuova scelta sostituisce proposta; revoca elimina soltanto la proposta locale |
| AMBIGUO | Checkbox e altro numero; almeno due interi distinti, export ordinato |
| ESCLUDI | Dialogo HTML di conferma aggiuntiva, nessun conteggio, nessuna modifica al vocabolario |
| Navigazione | Precedente/successiva/salta/prima non decisa; default Tutte; cursore per parola |
| Filtri | Ricerca per sottostringa/esatta, NFC/minuscolo; stato automatico; non decise/decise/saltate/tutte |
| PWA/offline | Manifest relativo, icone locali 192/512; cache esplicita dell'app shell, dati solo in IndexedDB |
| Aggiornamento | Nuova shell in attesa; attivazione esplicita senza salvataggi pendenti; cache con prefisso esclusivo |
| Multi-tab | BroadcastChannel e CAS su packageId/revisione dentro IndexedDB; scrittura obsoleta rifiutata; azioni su vista aggiornata da altro tab da ripetere |
| Backup/import | Base completa e decisione_base per parola; validazione preventiva; transazione unica; conferma di conflitti locali; nessun merge ufficiale |
| Autenticita' | UUID/autore/orologio/hash dichiarati non sono firme; importare file fidati |

Il README contiene schema completo, comandi, trasferimento sul telefono,
installazione, backup/ripristino e limiti. Nessuna decisione linguistica reale
aggiunta alla curatela; test manuali soltanto su fixture esplicitamente sintetiche.

## Pacchetto reale

Directory esterna della verifica storica:
`anagrammi-annotazioni-v2-83f81cdc-verificata` (non inclusa nel repository).
Nessun dataset riscaricato o rigenerato.

| Misura | Valore |
| --- | --- |
| Coda | revisione_prioritaria |
| Record | 13704 |
| Duplicati | 0 |
| Byte | 9246707 |
| SHA-256 | 0d1d67431c99d9612f0c5fcbfffa1f1ea086127de716e20a4ad92645c524d299 |
| File | `pacchetto-revisione-4814261c.json` (artefatto locale della verifica storica) |
| Base Git | 8de2796fbad84a411d23a7563f55b9f2482044f7 |
| Manifesto v2 SHA-256 | 84b13a11fd71f7e81824cc01b8b440fce3a25f0c04dc0c2589ea0d99887a12a0 |
| Vocabolario | 558124 grafie, SHA-256 b3b5703f69874095e9f9ac630ed0a608b919d969d5cd3a6b6477735db8595ad6 |
| Curatela | Schema1, vuota, SHA-256 7212b40c3a1308f79e220926247a9c6274e30d2e20c99ac8799844d447a71241 |

Ordine/indici e grafie confrontati alla coda originale; hash/dimensione coda
verificati rispetto al manifesto. Il pacchetto e' anche accettato dal validatore
JavaScript finale su tutti i record, incluse coerenza delle famiglie/candidati.
Importazione reale in IndexedDB riuscita. Nessuna decisione fatta su quel
pacchetto; successivamente sostituito nel collaudo da tre record sintetici.
Il pacchetto resta locale, NON aggiunto al repository o al service worker.

## Test eseguiti

- **55 test Python superati**, nessuno saltato: 14 nuovi per il packaging,
  41 della pipeline v2 invariata, inclusi i due controlli reali sul runner/audit.
- **13 test Node superati**, nessuno saltato: validazione, azioni, motivazioni,
  export senza saltate, modifica/revoca, ordine, base, import/conflitti, filtri,
  conteggi progresso e preservazione decisione_base.
- `node --check`: moduli app/db e service worker senza errori di sintassi.
- **9 verifiche su IndexedDB reale nel browser superate**, database UUID
  di prova isolato e cancellato alla fine: import, riapertura decisione+cursore,
  note, CAS concorrente, revoca, saltate non esportate, backup idempotente,
  proposta ESCLUDI e packageId concorrente incompatibile.
- Browser integrato: importazione reale di 13704 record; poi fixture sintetica,
  autore COLLAUDO SINTETICO, conferma, salto, refresh con decisioni/cursore
  conservati, AMBIGUO [2,3], modifica conteggio e DA_RIVEDERE verificati nella UI.
- Screenshot/layout iniziale a 390x844 e desktop: icone locali visibili,
  testo e comandi leggibili, nessuna sovrapposizione osservata.
- **Server 8765 arrestato**, ricaricata app: shell disponibile, sessione con
  tre decisioni sintetiche ancora presente e ambiguita' leggibile. Server poi
  riavviato. La prova verifica reale assenza del server, non solo un badge.

Un primo lancio Python con processo fuori sandbox non poteva leggere l'audit
temporaneo per permessi del profilo. Rilanciato con copia identica esterna al
repository nell'area di lavoro: tutti i 55 passano. Nessuna modifica ai test v2.

### Limiti del collaudo browser

Il browser integrato si e' bloccato durante un dialogo nativo di conferma.
Sono state sostituite le conferme native con dialoghi HTML accessibili nel
codice finale. Il blocco ha impedito di completare in questa sessione tutta
la sequenza UI finale: download effettivo del file, conferma/annullamento
ESCLUDI con il nuovo dialogo, ripristino via file picker e avviso BroadcastChannel
da due schede non sono certificati end-to-end. Logica di export/import e
protezione delle transazioni sono invece coperte dai test Node/IndexedDB.
Il timeout del download nel browser integrato non dimostra un errore del
download in Chrome/Safari: resta da verificare su browser normale/dispositivo.

La prova offline e le schermate delle decisioni utilizzano la shell gia'
cacheata durante il collaudo; i successivi ritocchi delle conferme e della
protezione multi-tab sono verificati da sintassi/test, non da un nuovo ciclo
completo UI/offline. Il README descrive la procedura ripetibile per completarlo.
Non sono stati provati installazione su telefono fisico, Safari/iOS, Web Share
di File, storage persistente concesso o aggiornamento completo su dispositivo.
Non installati Playwright/Puppeteer o altri strumenti nuovi.

## Limiti e licenze

64 MiB/100000 record, pacchetto caricato in RAM; usare blocchi per dispositivi
modesti e per la coda di 433438 stime. IndexedDB dipende dalla quota/profilo e
puo' essere cancellato o soggetto a eviction. Backup periodico necessario;
`storage.persist()` puo' essere negato. Export ripristina le decisioni, non
filtri, cursore, saltate o bozze senza decisione su un nuovo dispositivo.
Il normale refresh ripristina invece l'intera sessione locale.

Telefono: origin HTTPS per Service Worker/PWA (HTTP localhost per sviluppo).
Nessun deploy effettuato. La PWA vuota non include fonti lessicali. Il pacchetto
locale contiene piccoli testimoni derivati: WikiPron dati NON Apache2 del
codice; Wiktionary e PhonItalia richiedono verifica separata delle condizioni
e attribuzioni prima di redistribuzione pubblica. Licenza generale invariata.

## Integrita' conclusiva

Nessuna modifica a core, vocabolario, curatela, rimario, Unicode, console,
web principale, WASM, runtime, persistenza principale o pipeline v2.
Tutti i 52 file precedentemente tracciati invariati byte-per-byte.
Solo i 16 file nuovi elencati sopra, non staged.

```text
?? tools/prepara_revisione_mobile.py
?? tools/revisore_sillabe/
?? tools/tests/reviewer-core.test.mjs
?? tools/tests/reviewer-db-browser.html
?? tools/tests/reviewer-db-browser.mjs
?? tools/tests/test_prepara_revisione_mobile.py
```

Branch main; HEAD resta 8de2796fbad84a411d23a7563f55b9f2482044f7.
Nessun git add, commit, push o deploy. Nessun merge ufficiale o decisione
linguistica al posto dell'autore.
