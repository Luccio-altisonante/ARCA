# Runtime sillabico BITMAP-V1

Formato ufficiale: **sillabe-bitmap-le-v1**, runtime_version=1.
Generatore e lettore Python di riferimento in `tools/prepara_runtime_sillabe.py`.
Record+pool NON e' il formato ufficiale v1:
rimane solo una baseline nel tool di confronto, non importata dal generatore.

## Stato attuale

BITMAP-V1 e' integrato nel core C++ (`core/runtime_sillabe.*`, `core/api.*`),
nei binding WASM e nella web app, con filtro sillabico e cache PWA/offline.
Il runtime ufficiale richiede identita' SHA-256 e cardinalita' compatibili con
lo snapshot; il vocabolario personale usa il profilo ibrido descritto in fondo.
Provenienza e artifact distribuito sono documentati in
[SILLABE_DATASET.md](../../SILLABE_DATASET.md).

Le specifiche e le istruzioni seguenti sono correnti. La sezione esplicitamente
intitolata **Storia della migrazione e benchmark** conserva invece il verbale
precedente all'integrazione: affermazioni al futuro, test e assenze di quella
sezione non descrivono lo stato attuale. Il profilo personale finale e' corrente.

## Modello logico e snapshot

Ogni indice zero-based associa logicamente una parola dello snapshot a:
conteggi sillabici finali, stato, origine e R1. La rappresentazione fisica
inversa conteggio -> bitmap non cambia questo modello: voce(indice) ricostruisce
tutti i dati senza perdita. Nessuna hash table parola -> indice nel runtime.
Un eventuale indice stringa -> posizione appartiene al motore del vocabolario.

La pipeline enumera le righe senza riordinarle. Il generatore verifica OGNI
indice E parola contro le righe del vocabolario, poi non scrive le parole
nell'artifact. Identita' dello snapshot: SHA-256 dei byte del vocabolario e N.
Aggiunte/rimozioni/riordinamenti cambiano gli indici: vocabolari personali
modificati non possono usare ciecamente le posizioni dello snapshot ufficiale.
Non si duplica il comparatore rimario; non si normalizza o corregge l'input:
grafie non canoniche e duplicati sono rifiutati.

## Semantica upstream, non politica del filtro

Si conservano solo i conteggi FINALI della pipeline annotazioni schema 2,
politica offline-v2-evidenze, gia' soggetti alla precedenza della curatela.
Le cardinalita' seguenti appartengono all'output upstream validato, non sono
una politica inventata dal runtime:

| Codice uint8 | Stato | Cardinalita' |
| --- | --- | --- |
| 1 | RISOLTO | 1 |
| 2 | STIMA_CORROBORATA | 1 |
| 3 | SOLO_STIMA | 1 |
| 4 | CONFLITTO | 0 |
| 5 | DA_RIVEDERE | 0 |
| 6 | AMBIGUO | >=2 |
| 7 | ESCLUDI | 0 |

Riferimenti: tools/annota_sillabe.py, classifica (350-378),
carica_curatela (305-312), crea_record (395-405); test_annota_sillabe.py
(29-56, 78-84); tools/sillabe/README.md (108-125, 139-146).
CONFLITTO/DA_RIVEDERE possono avere candidati nelle evidenze, NON nei conteggi
finali. Evidenze/candidati, autori, date, motivazioni e automatico superato
dalla curatela non appartengono all'artifact runtime. Restano nel JSONL
identificato da hash. Non si inventano membership a partire dai candidati.

Origini: 1=automatico, 2=curatela_ufficiale. Zero e altri codici sono illegali.
Per origine manuale sono ammessi RISOLTO (CONFERMA), AMBIGUO, DA_RIVEDERE,
ESCLUDI. Il generatore valida anche la decisione inclusa nella riga, tramite
carica_curatela su un adattatore in memoria: non apre curatela reale o backup.

R1 e' indipendente dai conteggi finali; zero significa nessuna stima positiva.
compatibile(i,N) significa solo appartenenza di N ai conteggi finali:
nessun fallback R1, nessun giudizio su SOLO_STIMA, nessuna esclusione di AMBIGUO.

esclusione_in_attesa e' la proprieta' derivata stato == ESCLUDI:
**nessun campo binario o attributo indipendente**. ESCLUDI resta un'esclusione
pendente, non una rimozione dal vocabolario. Il flag nell'input JSONL e'
comunque verificato: bool esatto e coerente con lo stato.

## Layout binario definitivo

Tutti gli interi unsigned LITTLE-ENDIAN. SHA-256: 32 byte binari, non testo.
N=numero grafie; K=numero valori sillabici distinti presenti;
M=numero totale di membership, cioe' somma delle cardinalita' per parola.
N/K/M sono uint32. S=ceil(N/8)=(N+7)//8.

File canonico: header, N metadata, K directory, K bitmap contigue.
Nessun gap, overlap, trailer, compressione interna o padding fra sezioni.
Ogni variante non canonica e' rifiutata, anche con checksum coerente.

Header fisso: 192 byte, struct <8sHHIIIIIQQQQ32s32s32s32s.

| Offset | Tipo | Campo |
| --- | --- | --- |
| 0 | 8 byte | Magic 53 49 4c 4c 42 4d 00 00, SILLBM\0\0 |
| 8 | uint16 | Versione = 1 |
| 10 | uint16 | Dimensione header = 192 |
| 12 | uint32 | Flags riservati = 0 |
| 16 | uint32 | N |
| 20 | uint32 | K |
| 24 | uint32 | M |
| 28 | uint32 | Stride S |
| 32 | uint64 | Offset metadata = 192 |
| 40 | uint64 | Offset directory = 192 + 8*N |
| 48 | uint64 | Offset bitmap B = 192 + 8*N + 16*K |
| 56 | uint64 | Lunghezza file = B + K*S |
| 64 | 32 byte | SHA-256 byte originali vocabolario, incluso BOM/newline |
| 96 | 32 byte | SHA-256 byte originali annotazioni JSONL |
| 128 | 32 byte | SHA-256 payload, tutti i byte dopo l'header |
| 160 | 32 byte | Riservati = zero |

Metadata parola i: offset 192+8*i, struct <I4B, 8 byte.

| Offset relativo | Tipo | Campo |
| --- | --- | --- |
| 0 | uint32 | R1/algoritmo |
| 4 | uint8 | Stato |
| 5 | uint8 | Origine |
| 6 | uint8 | Riservato = 0 |
| 7 | uint8 | Riservato = 0 |

Directory j: offset directory_at+16*j, struct <IIQ, 16 byte.

| Offset relativo | Tipo | Campo |
| --- | --- | --- |
| 0 | uint32 | Valore sillabico positivo |
| 4 | uint32 | Popolazione = numero bit 1 |
| 8 | uint64 | Offset assoluto bitmap = B + j*S |

Valori strettamente crescenti, distinti, senza colonne vuote:
1 <= popolazione <= N. Somma popolazioni=M. Directory interamente dentro il
file; offset espliciti devono coincidere con gli offset canonici, non basta
che puntino a una bitmap leggibile. Nessuna rappresentazione alternativa.

Bitmap j: S byte. Parola i -> byte i//8, bit i%8, LSB-first.
Gli ultimi 8-(N%8) bit, se N non e' multiplo di 8, devono essere zero.
{2,3,7,1000} produce quattro bitmap, non mille. Nessuna colonna per valori
assenti. UINT32_MAX e piu' di 63 valori distinti sono rappresentabili.
N=0 -> K=M=S=0; offset sezioni e lunghezza=192.
K=0 e N>0 e' valido solo con M=0 e stati di cardinalita' zero.

Limiti: conteggi 1..UINT32_MAX; R1/N/K/M 0..UINT32_MAX.
Valori superiori sono errori, mai troncati. La curatela offline accetta interi
positivi piu' grandi: uint32 e' un vincolo dichiarato di rappresentazione.
Offset/lunghezze uint64: layout controlla ogni prodotto/somma di sezione.
Gli operandi uint32 garantiscono che anche N*K rientri in uint64; Python
non effettua wraparound. Il lettore C++ verifica la rappresentabilita' prima
di convertire a size_t/WASM32. Nuovi codici/semantiche richiedono una nuova versione.

## Validazione forte e memoria

valida_runtime verifica magic, versione, header size, flags, riservati,
layout/stride canonici, lunghezza esatta, troncamenti/extra, bounds;
directory positiva/ordinata/unica, offset contigui senza gap/overlap,
popolazioni reali tramite popcount, padding finale e M complessivo;
codici e riservati metadata, semantica di cardinalita'/origine di OGNI parola.
Checksum payload e, se forniti, SHA vocabolario, SHA annotazioni,
N e SHA dell'intero artifact attesi devono coincidere.

Durante la validazione: array uint32 temporaneo da **4*N byte**, incrementato
per ogni bit impostato. Le popolazioni vengono controllate prima di contare
le membership per parola; il totale e' limitato da M uint32.
La directory dimostra gia' positivita'/unicita' dei valori. Una tupla canonica
di pari cardinalita' riusa valida_voce per la semantica di ciascuna parola,
senza duplicare la politica upstream. Non e' un conteggio inventato nell'output.
Queste tuple sono transitorie O(K); l'array O(N) non viene conservato nel runtime.

A regime: buffer immutabile + due tuple directory O(K) nel lettore Python.
Nessun oggetto persistente per parola e nessuna mappa di stringhe.
Validazione O(N+K*S+M); statistiche O(N*K) nel riferimento semplice.
Il generatore offline materializza le voci: il suo picco RAM NON e' il budget
del caricatore C++/WASM. Un artifact rappresentabile puo' eccedere la RAM;
non e' ancora implementato un budget browser/WASM di allocazione.

Checksum payload non copre l'header. verifica_artifact usa SHA-256 dell'intero
file dal manifest e verifica entrambe le identita' degli input.
Senza hash attesi il lettore non puo' conoscere lo snapshot desiderato.
Hash/checksum non sono firme: serve una provenienza affidabile del manifest.

## API Python e algoritmi

- crea_runtime(voci, *, vocabolario_sha256, annotazioni_sha256) -> bytes.
- valida_runtime(bytes, *, vocabolario_sha256=None, annotazioni_sha256=None,
  grafie=None, artifact_sha256=None) -> RuntimeSillabe.
- leggi_runtime(path, **verifiche) -> RuntimeSillabe.
- genera(vocabolario, annotazioni, manifesto_input, artifact, manifesto_output).
- verifica_artifact(artifact, manifesto, *, vocabolario=None).
- runtime.voce(indice) -> VoceSillabica immutabile: conteggi tuple, stato,
  origine, algoritmo/R1, esclusione_in_attesa derivata.
- runtime.compatibile(indice, numero_sillabe) -> bool.
- runtime.indici_compatibili(numero_sillabe) -> iteratore di indici crescenti.
- runtime.statistiche() -> cardinalita' 0/1/>1, stati/origini, massimo conteggio
  effettivo e massimo R1.
- runtime.numero_grafie=N, numero_conteggi=M, numero_conteggi_distinti=K,
  bitmap_stride=S, vocabolario_sha256, annotazioni_sha256.

compatibile: valida indice e numero; bisect_left nella directory O(log K),
poi legge un bit. Numero assente -> False.
indici_compatibili: valida N immediatamente, cerca una colonna O(log K),
scandisce direttamente i suoi S byte ed enumera i bit 1; costo
O(log K+S+risultati), NON N query individuali.
voce: legge metadata O(1), scandisce K colonne e restituisce tutti i valori
con il bit i impostato, gia' ordinati. Costo O(K), compromesso deliberato.
Input indice/numero invalido -> ValueError, non False/risultato vuoto.

## Generatore, manifest e determinismo

Solo tre input espliciti: vocabolario, annotazioni complete v2 JSONL e
manifesto pipeline v2, politica offline-v2-evidenze. Nessun lookup su
dati_locali/backup, nessuna scoperta di curatela o lettura dei percorsi
dichiarati nelle provenienze. Pacchetti mobile/proposte/code non sono input.
Schema, politica, parole/indici, conteggi finali, origine, automatico e
decisione inclusa nella riga sono verificati; evidenze non riclassificate.
Hash dei tre input ricontrollati prima della scrittura; nessun input corretto
automaticamente. JSON massimo 16 MiB per record/manifesto input.

Manifest JSON schema 1, tipo manifesto_runtime_sillabe:
formato=sillabe-bitmap-le-v1; runtime_version=1; endianess=little;
numero_grafie=N; numero_conteggi_distinti=K; numero_conteggi=M;
bitmap_stride=S; artifact_byte; artifact_sha256;
vocabolario_sha256; annotazioni_sha256; manifesto_pipeline_sha256;
annotazioni_schema_version=2; politica_pipeline=offline-v2-evidenze;
hash_sorgenti_dichiarati; statistiche. Configurazione esatta:
conteggi=effettivi_della_pipeline, selezione_stati=nessuna,
fallback_algoritmo=False, esclusioni_dataset=False.
verifica_artifact confronta K/M/S/dimensione/statistiche con il buffer e
verifica versione, politica/configurazione e gli hash dichiarati.

Serializzazione JSON ordinata, senza timestamp, nomi output o valori ambientali.
Stessi byte input -> stesso artifact e stesso manifest byte-per-byte.
Output esterni al repository, distinti, nuovi, in directory gia' esistente;
creazione esclusiva, no overwrite. Errori ripuliscono solo file appena creati.
Non e' una transazione a due file resistente a spegnimenti.
Le garanzie dei percorsi presuppongono una directory affidabile, non ostile.

CLI: percorsi generici da sostituire con i propri input verificati e output
esterni nuovi. I test usano fixture sintetiche; una generazione ufficiale
richiede gli artefatti esterni della pipeline, non distribuiti con il clone.

~~~text
python -B tools/prepara_runtime_sillabe.py genera --vocabolario C:/fixture/vocabolario.txt --annotazioni C:/fixture/annotazioni.jsonl --manifesto-input C:/fixture/manifesto.json --artifact C:/output/sillabe.bin --manifesto-output C:/output/sillabe.json
python -B tools/prepara_runtime_sillabe.py verifica --artifact C:/output/sillabe.bin --manifesto C:/output/sillabe.json --vocabolario C:/fixture/vocabolario.txt
python -B tools/prepara_runtime_sillabe.py benchmark --grafie 100000 --query 20000
~~~

Exit 0=successo, 2=rifiuto/errore. Nessun download, apply, commit o deploy.

## Pubblicazione web verificata

I due manifest hanno scopi e contratti distinti:

- Il **manifest offline di provenienza** resta quello di `genera`: `schema_version`,
  `tipo=manifesto_runtime_sillabe`, `artifact_byte`, hash delle sorgenti, politica,
  configurazione e statistiche. `verifica` continua a ricevere questo manifest.
- Il **manifest web di pubblicazione** e' il puntatore consumato da `web/app.js`
  e dalle precondizioni di `web/build.ps1`: `schema=1`, `disponibile=true`,
  `formato`, `artifact`, `artifact_sha256`, `vocabolario_sha256`,
  `annotazioni_sha256`, `numero_grafie`, `dimensione_byte`.

Il comando esplicito `pubblica-web` riceve un binario esistente, il suo manifest
OFFLINE, il vocabolario e una directory esterna NUOVA, con parent gia' esistente.
Riusa `verifica_artifact`, inclusa l'identita' del vocabolario, prima di scrivere.
Non rigenera il runtime, non modifica il contratto offline e non allenta il web.

~~~text
python -B tools/prepara_runtime_sillabe.py pubblica-web --artifact C:/input/runtime.bin --manifesto C:/input/runtime-offline.json --vocabolario C:/input/VocabolarioItaliano.txt --output C:/output/nuovo-pacchetto-web
~~~

Il pacchetto contiene ESATTAMENTE due file: il binario originale copiato come
`runtime-sillabe-<SHA-256-effettivo-lowercase>.bin` e `runtime-sillabe.manifest.json`.
Nome, hash, dimensioni e metadati derivano solo dal buffer validato. Dopo la
scrittura vengono ricontrollati hash/dimensione della copia e integrita' degli
input; il manifest viene scritto dopo il binario verificato. Il buffer copiato
e' quello posseduto dal lettore validato, non una rilettura non verificata.

Nessun timestamp, percorso input o nome directory entra nel manifest web:
stessi input -> stesso binario e stesso manifest byte-per-byte. N=0 e' ammesso
offline ma non pubblicabile, per rispettare il contratto web di grafie positive.
Le validazioni web reali vengono eseguite nei test, non duplicate in Python.

Output obbligatoriamente esterno, nessun overwrite: directory prenotata con
creazione esclusiva e file aperti in modo esclusivo. In caso di eccezione si
rimuovono solo i file appena creati e la directory del pacchetto, senza lasciare
una pubblicazione parziale. Come per `genera`, si presuppone una directory
affidabile/non ostile; non e' una transazione resistente a spegnimenti improvvisi.

Questo comando NON copia nulla in `web/data`, NON modifica il manifest web e NON
esegue build, commit, push o deploy. L'integrazione nel repository resta una
operazione esplicita separata; il repository contiene gia' il runtime approvato
e il relativo manifest web. La conformance del binario continua a usare il
manifest OFFLINE, non quello web, che non lo sostituisce.

## Storia della migrazione e benchmark

**Snapshot storico precedente all'integrazione C++/WASM/web.** Fino alla
sezione corrente **Filtro sillabico personale ibrido**, formule applicate
all'artifact automatico, misure, test, stato Git e funzionalita' allora assenti
sono il verbale di quella migrazione, non il riepilogo della release attuale.

### Dimensione e K automatico reale

Formula esatta: **192 + 8*N + 16*K + K*ceil(N/8)**.
M non occupa un pool: e' conservato come controllo aggregato nell'header.
Per K piccolo il buffer e' significativamente piu' piccolo di record+pool;
K molto grande puo' annullare il vantaggio (circa K=96 per M/N vicino a 1).

Usato esclusivamente in SOLA LETTURA l'artifact AUTOMATICO documentato in
tools/sillabe/SECONDA_ESECUZIONE.md, precedente alla campagna manuale:
directory esterna della verifica storica `anagrammi-annotazioni-v2-83f81cdc-verificata`.
Verificati prima della lettura semantica:
- manifesto.json SHA-256:
  84b13a11fd71f7e81824cc01b8b440fce3a25f0c04dc0c2589ea0d99887a12a0;
- annotazioni.jsonl SHA-256:
  b0fbc025ff61775612747e8567ff091c08b1872371c81c15b883d22043b96eaf;
- il manifesto indica curatela vuota storica con SHA-256:
  7212b40c3a1308f79e220926247a9c6274e30d2e20c99ac8799844d447a71241.
Nessun percorso curatela e' stato seguito e nessun file di decisioni letto.
Tutte le righe lette hanno origine automatico, schema 2 e indici contigui.
L'identita' vocabolario documentata coincide con l'attuale file versionato:
b3b5703f69874095e9f9ac630ed0a608b919d969d5cd3a6b6477735db8595ad6.

Misurati: N=558124, K=13, conteggi distinti 1..13, M=544424, S=69766.
Dimensione BITMAP-V1 prevista: **5372350 byte**, circa 5.12 MiB.
Array temporaneo: **2232496 byte**, circa 2.13 MiB.
Buffer + array: 7604846 byte, circa 7.25 MiB, esclusi vocabolario,
copie/trasferimenti/decompressione e piccoli overhead directory.
Record+pool equivalente: 11107840 byte; risparmio raw circa 51.63%.
Sono formule applicate alle statistiche: NON e' stato generato un runtime reale.

### Confronto e progettazione storica C++/WASM

tools/confronta_runtime_sillabe.py conserva record+pool solo come baseline
locale dell'esperimento. Confronta la bitmap UFFICIALE con validazione completa
e hash equivalenti. Per ogni fixture verifica anche identita' byte-per-byte
col prototipo bitmap precedente e roundtrip di tutte le informazioni.
Nessuna dipendenza del generatore ufficiale dai tre file sperimentali.
Il rapporto CONFRONTO_RUNTIME.md e' lasciato come documento storico.

Misure sintetiche riproducibili: 100000 parole, 20000 query, tre ripetizioni,
mediane. Raw, gzip/zlib livello 9; copia RAM distinta da validazione e
caricamento validato (copia+validazione); ricostruzione voce su batch;
filtro globale N=2. Le misure Python non sono prestazioni WASM e non
rappresentano la compressione reale delle annotazioni.

~~~text
python -B tools/confronta_runtime_sillabe.py --grafie 100000 --query 20000 --ripetizioni 3
~~~

#### Benchmark dopo la migrazione

Python 3.12.14, Windows 11 build 26200, zlib 1.3.2. Nessuna suite completa
in parallelo al benchmark. Tempi indicativi e mediane indipendenti, sensibili
al carico del sistema: caricamento validato non e' la somma di due mediane.
N=100000 per scenario; dimensioni in byte.

| Scenario | Formato | M | K | Raw | Byte/parola | Gzip 9 | Zlib 9 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Quasi univoche | record_pool | 97480 | 8 | 1990080 | 19.90080 | 360003 | 359991 |
| Quasi univoche | bitmap | 97480 | 8 | 900320 | 9.00320 | 170076 | 170064 |
| Molte ambigue | record_pool | 147409 | 8 | 2189796 | 21.89796 | 415793 | 415781 |
| Molte ambigue | bitmap | 147409 | 8 | 900320 | 9.00320 | 190999 | 190987 |
| Molte vuote | record_pool | 45082 | 8 | 1780488 | 17.80488 | 330649 | 330637 |
| Molte vuote | bitmap | 45082 | 8 | 900320 | 9.00320 | 159420 | 159408 |
| Dispersi {2,3,7,1000} | record_pool | 119901 | 4 | 2079764 | 20.79764 | 354226 | 354214 |
| Dispersi {2,3,7,1000} | bitmap | 119901 | 4 | 850256 | 8.50256 | 149285 | 149273 |

| Scenario | Formato | Copia RAM ms | Validazione ms | Caricamento validato ms | 20k query ms | Voce us | Filtro tutte N=2 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Quasi univoche | record_pool | 1.759 | 667.510 | 670.136 | 42.669 | 3.022 | 195.648 |
| Quasi univoche | bitmap | 0.979 | 442.382 | 440.206 | 26.330 | 6.600 | 4.327 |
| Molte ambigue | record_pool | 2.263 | 758.874 | 858.110 | 53.318 | 3.926 | 210.813 |
| Molte ambigue | bitmap | 0.875 | 563.916 | 560.839 | 24.436 | 5.730 | 5.055 |
| Molte vuote | record_pool | 1.693 | 751.181 | 747.860 | 35.749 | 3.089 | 153.107 |
| Molte vuote | bitmap | 1.127 | 746.782 | 468.669 | 31.180 | 6.194 | 2.506 |
| Dispersi {2,3,7,1000} | record_pool | 1.749 | 756.327 | 869.434 | 57.116 | 4.200 | 239.675 |
| Dispersi {2,3,7,1000} | bitmap | 1.243 | 670.046 | 650.859 | 30.404 | 6.781 | 10.225 |

Le dimensioni ufficiali sono identiche a quelle del prototipo del confronto
precedente. I risultati delle query e del filtro sono verificati contro
la fixture sorgente; filtri N=2: 12343, 18411, 5549, 29967 indici rispettivamente.
La ricostruzione di una voce conserva tutti i conteggi, R1, stato e origine.

Il futuro C++ leggera' gli interi LE senza dipendere da struct packed,
verifichera' overflow, bounds, hash dello snapshot e budget RAM WASM32.
Il valore uint32 e' esatto anche in Number JS; offset uint64 richiedono
conversioni controllate in C++ o DataView/BigInt.
Non sono stati creati binding, fetch, filtri UI o indici stringa->posizione.

### Test e perimetro della migrazione

~~~text
python -B -m unittest discover -s tools/tests -p test_prepara_runtime_sillabe.py -v
python -B -m unittest discover -s tools/tests -p test_confronta_runtime_sillabe.py -v
python -B -m unittest discover -s tools/tests -q
~~~

Tutte le fixture dei TEST e i runtime generati sono sintetici, temporanei
ed esterni. Nessun test usa l'artifact reale sopra, dati_locali o backup.
Coperti N=0/1, multipli/non multipli di 8, K=0/1/molti, padding, uint32 massimi,
directory non canonica/gap/overlap, popcount, codici/riservati/cardinalita',
query/iteratore, modello per parola, R1 separato, esclusione derivata,
assenza di memoria O(N) permanente/hash table parole, determinismo,
manifest, troncamenti/extra/hash, output vietati e rifiuto overwrite.

#### Esito finale della migrazione

Test runtime: 51 passati. Test confronto: 24 passati.
Suite Python completa: 190 test, 187 passati, 3 skip, nessun fallimento
(119.570 s). Skip: runner/audit reale esterni non configurati e privilegio
symlink Windows assente. Nessun test usa backup/decisioni della campagna.

Modificati solo cinque file preesistenti:
- tools/prepara_runtime_sillabe.py;
- tools/tests/test_prepara_runtime_sillabe.py;
- tools/sillabe/RUNTIME_SILLABE.md;
- tools/confronta_runtime_sillabe.py (baseline record+pool e confronto ufficiale);
- tools/tests/test_confronta_runtime_sillabe.py (adattamento API, equivalenza).

Nessun nuovo file creato in questa migrazione; i tre file del confronto sono
conservati e CONFRONTO_RUNTIME.md resta byte-per-byte invariato.
Controllati gli SHA-256 iniziali/finali di 58 file protetti: nessuna differenza,
inclusi revisore/PWA, curatela, pipeline, core/web/console/dist e vocabolario.
La curatela reale e' stata solo sottoposta a hash per integrita', mai interpretata.
Nessun backup, dati_locali o decisione manuale corrente consultato.
Nessun runtime reale generato; l'artifact automatico e' stato solo misurato.

HEAD invariato: 8c26f0e73e923cde152e54ac3fafe1ab7630b128.
Working tree senza diff tracked/staged; sei file ancora untracked come prima:

~~~text
## main...origin/main
?? tools/confronta_runtime_sillabe.py
?? tools/prepara_runtime_sillabe.py
?? tools/sillabe/CONFRONTO_RUNTIME.md
?? tools/sillabe/RUNTIME_SILLABE.md
?? tools/tests/test_confronta_runtime_sillabe.py
?? tools/tests/test_prepara_runtime_sillabe.py
~~~

Nessun git add/commit/push/deploy nel progetto. Nessuna modifica o integrazione
C++/WASM/web/PWA/persistenza; nessun riordinamento/rigenerazione vocabolario.

## Filtro sillabico personale ibrido

Il runtime ufficiale mantiene il vincolo SHA-256 e cardinalita' dello snapshot.
Non viene associato per indice a un vocabolario personale. Il core offre invece
`prepara_sillabe_personali()` (solo euristica) e
`prepara_sillabe_personali_da_ufficiale(motore)` (fonte gia' verificata).

La fonte immutabile condivisa conserva parole, runtime e un vettore di indici
ordinati per grafia. La ricerca binaria confronta la grafia normalizzata/NFC dal
core, senza modificare il rimario. Il profilo personale ha due uint32 per voce:
riferimento alla grafia ufficiale oppure conteggio di `conta_sillabe()`.
Non alloca un vettore di conteggi per ogni parola e non e' persistito in IndexedDB.
Grafie duplicate nella fonte condividono l'unione dei conteggi ufficiali; ogni
candidato personale rimane distinto e non viene moltiplicato dai conteggi.

AMBIGUO conserva i conteggi multipli; ESCLUDI e altri stati senza conteggi non
passano i filtri. Solo grafie assenti dalla fonte usano la stima euristica, che
puo' essere inesatta; una stima zero non passa filtri positivi. Senza dati
ufficiali il personale usa interamente l'euristica, mentre l'originale continua
a richiedere il runtime verificato. La UI distingue queste condizioni.

Dopo aggiunta/rimozione il core inserisce/elimina solo la voce interessata,
mantenendo la fonte ufficiale anche per successive riaggiunte. I duplicati di
una grafia rimossa vengono eliminati tutti, come nell'API storica. Aggiunta gia'
presente e rimozione assente sono no-op: non riordinano, non modificano il
profilo e non invalidano identita'/runtime o snapshot delle API dirette.
L'esecuzione di un comando continua a invalidare lo snapshot precedente.
La ricostruzione completa resta per preparazione/caricamento/promozione e
applicazione batch delle modifiche persistite. Tutte le ricerche
lessicali usano il profilo prima della formattazione; `^` filtra il bacino prima
dell'estrazione. Le API paginate rimangono il percorso della UI. I comandi
`+ parola` / `- parola` richiedono il personale e il filtro della chiamata spento.
Il browser conserva una sola fonte verificata per sessione; ricaricando il
personale puo' recuperarla online o dalla cache approvata, altrimenti stima.
Runtime, manifest ufficiale, formato BITMAP-V1 e persistenza non cambiano.

Se i dati ufficiali arrivano dopo una ricerca personale basata sulla stima,
la UI libera lo snapshot obsoleto e invita a ripetere la ricerca: non rilegge
pagine incompatibili e non riesegue automaticamente estrazioni casuali.
Il profilo occupa 8 byte per parola; l'indice condiviso occupa 4 byte per grafia
ufficiale, oltre alla copia immutabile di Words e runtime. La preparazione
iniziale rimane sincrona e puo' bloccare il thread per alcuni secondi; le singole
modifiche spostano elementi dei vettori ma non ricalcolano le voci esistenti.
Non sono introdotti worker o override personali.

Gli inserimenti hanno strong guarantee sullo stato logico: normalizzazione,
comparatore, riserva Words e preparazione/inserimento della nuova voce precedono
il commit Words, che non alloca e usa move di stringhe noexcept. In caso di
errore puo' cambiare solo la capacita' riservata, non parole, profilo, fonte,
ordine, identita', runtime o snapshot. Il percorso raro di un motore non ancora
ordinato prepara una copia e permuta le voci con gli stessi indici rimario,
senza ricalcolare conteggi; il commit avviene solo al successo.
La rimozione, dopo normalizzazione, non alloca; anche il batch prepara Words e
profilo su copie prima del commit. I test interrompono a turno le allocazioni
C++ per verificare queste garanzie. UINT32_MAX e' riservato: anche una stima
esattamente uguale viene rifiutata, con test dei limiti senza parole gigantesche.

La rimozione dal pulsante di un risultato conserva comando, filtro serializzabile,
modalita', valori e pagina dello snapshot. Dopo la modifica non filtrata
riesegue la ricerca con quel contesto, ripristina i controlli e limita la pagina
all'ultima ancora valida; non conserva oggetti filtro Embind.

La fonte copia Words/runtime del motore ufficiale trattenuto dal browser:
questa duplicazione protegge la sua immutabilita' ma aumenta la memoria.
Una futura ottimizzazione potrebbe condividere uno snapshot immutabile con il
motore sorgente invece di copiarlo. E' rinviata: richiede verificare ownership
e mutazioni del motore. La memoria HEAP riservata non misura le allocazioni vive
e non si riduce dopo delete; gli switch ripetuti vanno misurati a plateau.

Misura indicativa C++/WASM diagnostico sul dataset reale (558.124 grafie):
preparazione iniziale 1,55 s; + sconosciuta 12 ms; - stessa grafia 10 ms;
+ gia' presente 0,11 ms; - assente 1,29 ms. Non sono soglie di test.
Strumentazione mallinfo esterna al progetto: originale+runtime circa 19,4 MB
di blocchi allocati, personale con fonte 65,7-66,2 MB su otto switch; nessuna
crescita progressiva, circa 1,3 KB dopo distruzione e zero handle Embind.
HEAP riservata diagnostica: 59,4 MB originale, 102,8 MB personale, plateau
148,1 MB. Nel browser con ricerche/paginazione raggiunge 177,7 MB: include
picchi e memoria riutilizzabile, non e' il totale di strutture vive.
