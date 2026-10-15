# Release e offline Anagrammi, fase 1

`build.ps1` compila WASM e produce `dist/index.html`, `service-worker.js`,
`release.json` e `releases/<release_id>/`. L'HTML di produzione punta alla
release concreta anche senza service worker; lo sviluppo da `web/` non registra SW.

L'inventario schema 1 contiene `release_id`, `identity_scheme`, `identity_inputs`
e `assets` con `path`, `size_bytes`, `sha256`. Tutti gli asset sono verificati
durante il precache. `index.html` e' derivato, quindi escluso dal seed per evitare
un hash autoreferenziale: il seed include invece i byte del suo template.

`release_id` e' SHA-256 del testo UTF-8 con LF:
`anagrammi-release-v1\n`, poi righe `path\tsize_bytes\tsha256\n` per i due
input (template HTML, template SW), poi per gli asset non derivati in ordine
ordinale del percorso. Non contiene date, nomi assoluti o valori casuali.
Gli input esatti possono legittimamente differire fra versioni del compilatore.

Il precache comprende HTML, CSS, app/persistenza JS, loader JS, WASM, vocabolario,
manifest PWA e documentazione dataset. La cache `anagrammi-app-release-<id>` viene
marcata completa solo dopo tutti i put. Una installazione fallita elimina la
cache candidata. Non vengono usati skipWaiting o clients.claim.
La metadata cache `anagrammi-app-metadata-v1` conserva gli ID corrente/precedente.
La GC elimina soltanto cache del nostro namespace; la build conserva anche la
precedente directory di release per non rompere richieste durante un aggiornamento.

Navigazioni a root/index servono l'HTML della release attiva; gli asset immutabili
usano cache-first con fallback di rete verificato. Gli altri URL, incluso il
canale sillabico root `data/`, passano normalmente. Il runtime resta opzionale,
non bloccante e senza precache del service worker.
Le verifiche SHA-256 del core C++ restano obbligatorie.

Servire su HTTPS (oppure localhost) con MIME corretti, in particolare
`application/wasm` e JavaScript. Pubblicare l'intero output, non singoli file.
Il manifest PWA include icone proprie 192/512 e maskable; l'installabilita' e'
verificata nei test Chrome locali, non su tutti i browser o dispositivi.
Non sono riutilizzate le icone del revisore.
Quota, eviction e cancellazione dei dati possono rimuovere l'offline; non viene
richiesta automaticamente la persistenza dello storage.

## Test

In una copia usa-e-getta SENZA `.git`, eseguire prima `web/build.ps1`, poi:

```text
node tests/pwa_test.mjs <copia-progetto> <playwright/index.mjs> --rebuild
```

`PWA_POWERSHELL` seleziona lo stesso PowerShell della prima build;
`PWA_CHROME` puo' selezionare Chrome. Il test ricompila per confrontare due
build identiche, genera release sintetiche B/C cambiando temporaneamente solo
la copia di CSS/vocabolario e ripristina gli input nel finally. Per B/C riusa
il WASM e seleziona il packaging dalla AST del build, senza un secondo builder.
Non eseguire questo test nel repository o su un output destinato al deploy.
Verifica inventario, quota/hash/404, lifecycle reale, navigazioni offline,
persistenza personale e isolamento delle cache estranee. Il test non cancella
database esistenti: usa un contesto Chrome isolato.

## Runtime offline, fase 2

Un manifest di rete valido e i byte scaricati sono soltanto CANDIDATI. L'app
li associa sul motore originale/generazione attivi tramite
`associa_runtime_sillabe_da_bytes(bytes, artifact_sha256)`: C++ verifica hash,
formato, struttura, snapshot del vocabolario e cardinalita'. PRIMA della
chiamata C++ un precheck confronta dimensione dichiarata, lunghezza minima
leggibile e metadati manifest/header (grafie, hash vocabolario e annotazioni).
Questo precheck NON e' una verifica di sicurezza: evita soltanto di associare
un candidato gia' incoerente con il manifest. C++ verifica sempre tutti i
controlli autorevoli, senza introdurre un nuovo hash semantico.

`runtime-sillabe-storage.js` usa esclusivamente la cache
`anagrammi-app-syllable-runtime-v1`, fuori dalle cache release/revisore e da
IndexedDB. Le chiavi artifact e metadata sono relative al canale `data/`.
Il puntatore locale `.anagrammi-approved-runtime-v1` contiene:

```json
{"schema":1,"corrente":null,"precedente":null}
```

I due valori, quando presenti, sono oggetti manifest: conservano schema/formato, filename,
SHA artifact/vocabolario, numero grafie e gli eventuali SHA annotazioni e
dimensione dichiarati. Non sono copie dell'ultimo manifest semplicemente visto.

Sotto un Web Lock esclusivo condiviso fra schede: scrittura byte completi,
poi PUT del puntatore PER ULTIMO (commit logico), poi GC. Una promozione
fallita prima del commit conserva il vecchio puntatore e ripulisce gli orfani.
Se la generazione diventa obsoleta durante il PUT del puntatore, il vecchio
puntatore viene ripristinato sotto lo stesso lock prima di permettere letture.
Se lo storage fallisce, il runtime C++ gia' associato resta pronto in memoria;
il precedente approvato resta il fallback. Un errore di GC dopo il commit non
annulla un'approvazione valida; la pulizia viene ritentata alla promozione o
lettura locale seguente, anche per orfani lasciati da un'interruzione.
Senza Cache Storage/Web Locks le normali ricerche e il runtime online restano
utilizzabili, ma le scritture condivise non sicure sono disabilitate.

Errori di fetch, HTTP o timeout di manifest/artifact permettono il fallback
locale senza un'altra attesa di rete. JSON/schema/metadati/hash/formato o
snapshot invalidi NON attivano automaticamente il vecchio runtime: lo stato
resta errore per non mascherare un candidato server corrotto. Un manifest
valido `disponibile:false` prevale online; i precedenti byte vengono conservati
solo per un futuro avvio offline, non usati nella sessione corrente.

Il fallback rilegge byte e manifest approvati, ma ripassa SEMPRE dal binding
C++ contro il vocabolario attuale. Se corrotto/incompatibile viene scartato
(o ignorato se lo storage non permette la rimozione); solo un puntatore che
identifica ancora quel runtime viene modificato, mai quello di un nuovo
runtime approvato da un'altra scheda. Il precedente, se presente, resta
candidato al prossimo tentativo offline e dovra' essere riverificato.
Lo scarto controlla la generazione dopo gli await del puntatore e della GC.
Se diventa obsoleto, ripristina sotto lo stesso lock gli eventuali byte della
vecchia voce cancellati da una delete gia' in volo, poi il vecchio puntatore.

Tutti i percorsi controllano il token di generazione; nessun riferimento
WASM attraversa un await. Metadata interni `origine: rete/locale` ed eventuale
`errorePersistenza` non introducono UI. GC conserva corrente e al massimo
un precedente completo, cancellando soltanto artifact del nostro canale/cache.
Il SW resta estraneo al runtime e la release identity include solo il nuovo
modulo JS, non manifest/artifact mutabili. Nessun runtime definitivo e' incluso.

La suite `web_runtime_sillabe_test.mjs` usa BITMAP-V1 sintetici e il binding
WASM reale: verifica promozione, quota, offline, candidato invalido, timeout
simulati, cambi generazione, concorrenza e isolamento. `pwa_test.mjs` verifica
anche Cache Storage/Web Locks reali in due pagine Chrome isolate.
