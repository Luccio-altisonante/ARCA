# Valutazione prima del congelamento del runtime sillabico v1

Esperimento separato dal generatore esistente. Non integra nulla in C++, WASM,
web o revisore. Non legge curatela reale, dati_locali, backup o annotazioni reali.
Il formato record+pool e i suoi test/documenti preesistenti restano invariati.

## 1. Semantica upstream e perdita d'informazione

Le cardinalita' dei **conteggi finali** non sono una nuova politica del runtime:
sono quelle dell'output valido della pipeline annotazioni schema 2,
politica `offline-v2-evidenze`, con curatela schema 1 validata.

| Stato | Significato dei conteggi finali v2 | Upstream | Runtime attuale | Perdita dei conteggi finali |
| --- | --- | --- | --- | --- |
| RISOLTO | Unico conteggio concordante o confermato manualmente | 1 | 1 | No |
| STIMA_CORROBORATA | Unico candidato concorde con R1 | 1 | 1 | No |
| SOLO_STIMA | R1 positivo, senza evidenze lessicali utili | 1 | 1 | No |
| CONFLITTO | Nessuna scelta finale fra evidenze discordanti | 0 | 0 | No |
| DA_RIVEDERE | Nessun conteggio finale sufficientemente validato | 0 | 0 | No |
| AMBIGUO | Alternative sillabiche attestate oppure curate | >= 2 | >= 2 | No |
| ESCLUDI | Esclusione manuale pendente del termine | 0 | 0 | No |

Riferimenti verificati sui file attuali, non dedotti dai soli nomi degli stati:

- `tools/annota_sillabe.py:350-378`: tutti i rami di `classifica`;
  CONFLITTO a 350-354, DA_RIVEDERE a 355-357, 365-367, 368-374,
  AMBIGUO a 361-364; `candidati_lessicali` distinto a 378.
- `tools/annota_sillabe.py:305-312`: ordinamento/unicita'/positivita' e
  cardinalita' delle quattro azioni manuali in `carica_curatela`.
- `tools/annota_sillabe.py:395-405`: conteggi finali automatici oppure sostituiti
  dalla curatela; CONFERMA diventa RISOLTO.
- `tools/annota_sillabe.py:475` e `:504`: la pipeline valida la curatela prima
  di generare le righe. `crea_record` chiamata direttamente con un dict
  arbitrario non e' da sola un validatore. Il numero `schema_version=2`
  in un JSON estraneo non garantisce che questi vincoli siano rispettati.
- `tools/tests/test_annota_sillabe.py:29-56`: RISOLTO, conflitto vuoto con
  candidati `[2,3]`, ambiguita' `[2,3]`, stima e rinvio.
- `tools/tests/test_annota_sillabe.py:78-84`: azioni manuali, conteggi vuoti e flag.
- `tools/sillabe/README.md:108-125`, `:139-146`: semantica documentata;
  la v2 elimina intenzionalmente dal campo finale il candidato non confermato
  che la v1 talvolta vi riportava.

**Distinzione importante:** entrambi i runtime NON conservano tutta
l'annotazione JSON. Candidati lessicali, evidenze originali, motivazioni,
provenienza dettagliata e classificazione automatica sostituita dalla curatela
rimangono soltanto nell'artifact upstream. CONFLITTO e DA_RIVEDERE possono avere
candidati non vuoti in tali campi, ma NON in `conteggi` finali.
Non e' corretto riempire il pool con quei candidati: cambierebbe il significato
del dato. Se servissero in futuro nel runtime, occorrerebbe un campo separato
esplicito e una revisione del contratto, non una politica nascosta nel filtro.

Il runtime introduce invece un limite **di rappresentazione dichiarato**:
uint32 per conteggi/R1/N/M. La curatela offline accetta interi positivi senza
limite uint32. Un valore maggiore viene rifiutato, non troncato o perso
silenziosamente. La tabella riguarda dati rappresentabili in tale contratto.
`compatibile(i,N)` rimane pura appartenenza ai conteggi: nessun fallback R1,
nessuna nuova politica di confidenza/stato.

## 2. Esclusione

Nell'output valido `esclusione_in_attesa == (stato == "ESCLUDI")` sempre:
la classificazione automatica non produce ESCLUDI; `crea_record` inizializza
False a 398 e lo imposta da azione ESCLUDI a 405. Questa azione e' ammessa solo
con conteggi vuoti. L'esclusione e' **pendente**, non gia' applicata al vocabolario.
Il byte attuale e' ridondante. Non lo cambiamo nell'esistente: nel prototipo
si deriva il flag dallo stato e si riservano due byte metadata a zero.
Un futuro significato indipendente richiedera' una versione esplicita, non
due verita' potenzialmente discordanti nello stesso formato.

## 3. Layout BITMAP-V1 sperimentale

Tutti gli interi little-endian; indici parole zero-based nello stesso snapshot.
Magic diversa dal formato attuale: `SILLBM\0\0`. Non e' un v1 congelato.

Header: 192 byte, struttura `<8sHHIIIIIQQQQ32s32s32s32s`.

| Offset | Tipo | Campo |
| --- | --- | --- |
| 0 | 8 byte | Magic |
| 8 | uint16 | Versione sperimentale = 1 |
| 10 | uint16 | Dimensione header = 192 |
| 12 | uint32 | Flags riservati = 0 |
| 16 | uint32 | N, numero parole |
| 20 | uint32 | K, numero conteggi distinti presenti |
| 24 | uint32 | M, somma di tutti i conteggi per parola / bit impostati |
| 28 | uint32 | Stride bitmap = ceil(N/8) |
| 32 | uint64 | Offset metadata = 192 |
| 40 | uint64 | Offset directory = 192 + 8*N |
| 48 | uint64 | Offset bitmap = 192 + 8*N + 16*K |
| 56 | uint64 | Lunghezza file esatta |
| 64 | 32 byte | SHA-256 vocabolario |
| 96 | 32 byte | SHA-256 annotazioni |
| 128 | 32 byte | SHA-256 payload, tutto dopo l'header |
| 160 | 32 byte | Riservati, tutti zero |

Metadata per parola, 8 byte, `<I4B`:
R1 uint32 a 0; stato uint8 a 4; origine uint8 a 5;
riservati zero a 6 e 7. Codici stati 1..7 e origini 1..2 identici all'attuale.
R1 non deve coincidere con i conteggi finali; zero resta rappresentabile.
ESCLUDI e' conservato nello stato e restituito anche come flag derivato.

Directory: K record da 16 byte, `<IIQ`:
conteggio positivo uint32 a 0; popolazione uint32 a 4;
offset assoluto uint64 a 8. Valori strettamente crescenti, senza duplicati.
Nessuna colonna vuota o inutilizzata; popolazione in 1..N.
Ogni offset e' esattamente `bitmap_at + j*stride`.

Seguono K bitmap contigue da stride byte. Parola i: byte i//8,
bit i%8, LSB-first. Padding dell'ultimo byte obbligatoriamente zero.
`{2,3,7,1000}` usa quattro colonne, non mille.
`UINT32_MAX` e piu' di 63 colonne sono testati; nessun massimo 31/63.
N=0 comporta K=M=stride=0 e file di soli 192 byte.

Formula raw: **192 + 8*N + 16*K + K*ceil(N/8)**.
Record+pool invariato: **160 + 16*N + 4*M**.

## 4. Validazione equivalente

Entrambi controllano magic/versione, riservati, dimensioni/offset canonici,
assenza di byte extra/troncamenti, hash vocabolario e N attesi opzionali,
checksum payload e SHA-256 dell'intero artifact atteso opzionale.
Nel benchmark sono forniti tutti e tre i controlli esterni.
L'hash annotazioni e' conservato identico; l'hash artifact atteso lo vincola
insieme a tutto l'header. Il solo checksum payload non protegge l'header.
SHA-256 non e' autenticazione: servira' un manifesto affidabile in entrambi.

Bitmap verifica inoltre directory ordinata/positiva, popolazioni reali,
padding, M totale, ogni codice e cardinalita'/origine per ogni parola.
Le cardinalita' si ricostruiscono con un array uint32 temporaneo da **4*N byte**;
non si costruiscono N tuple di conteggi persistenti. La positivita'/unicita'
dei valori e' provata dalla directory; i bit definiscono insiemi, non liste
con duplicati. Il validatore riusa `valida_voce` con una tupla canonica di pari
cardinalita' per non introdurre una politica differente dal record.
Gli artifact corrotti sono testati anche con checksum ricalcolato.

## 5. Metodo del confronto

Solo fixture sintetiche in memoria, PRNG con seed fisso, nessun dato reale.
Per ogni scenario, le medesime VoceSillabica sono serializzate in entrambi i
formati, validate e confrontate parola per parola, incluso R1/origine/flag.
Sono controllati anche tutti i risultati delle query e del filtro contro
la fixture sorgente, non soltanto contro l'altro formato.

Scenari probabilistici: quasi univoche 95% singole/1% ambigue/4% vuote;
molte ambigue 60%/35%/5%; molte vuote 20%/10%/70%;
valori dispersi 70%/20%/10% su `{2,3,7,1000}`.
Ambigue: 2 o 3 valori distinti. Sono rappresentati tutti gli stati e le origini;
ESCLUDI nella fixture ha sempre origine curatela_ufficiale.

Dimensione raw e compressioni standard Python livello 9, gzip mtime=0.
Tempi mediani di 3 ripetizioni; 100.000 parole/scenario e 20.000 query identiche.
La copia buffer e' `bytes(bytearray(data))`: costo RAM, **non** download,
lettura disco o decompressione. Il caricamento validato misura copia+validazione;
e' una misura distinta, non la somma di due mediane.
Ricostruzione: media per parola su un batch di 20.000 accessi, mediane dei batch;
restituisce tutta la voce e alloca l'output in entrambi i casi.
Filtro primario: tutti gli indici compatibili con N=2, in ordine di vocabolario;
record scansisce le parole con compatibile, bitmap scansisce una sola colonna.
Non applica alcuna politica di stato aggiuntiva.

Le misure sono del lettore Python di riferimento, **non** prestazioni WASM.
Non estrapolare le dimensioni gzip sintetiche a un dataset reale.
Il vecchio prototipo bitmap non validato e i suoi tempi non sono usati
per questo confronto.

Comando riproducibile, senza scrivere artifact:

```text
python -B tools/confronta_runtime_sillabe.py --grafie 100000 --query 20000 --ripetizioni 3
python -B -m unittest discover -s tools/tests -p test_confronta_runtime_sillabe.py -v
```

## 5a. Risultati misurati

Ambiente: Python 3.12.14, Windows 11 build 26200, zlib 1.3.2.
Esecuzione finale senza suite Git/test in parallelo; carico del sistema non isolato.
Dimensioni in byte; M/K effettivi della fixture, non percentuali arrotondate.

| Scenario | Formato | N | M | K | Raw | Byte/parola | Gzip 9 | Zlib 9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Quasi univoche | record_pool | 100000 | 97480 | 8 | 1990080 | 19.90080 | 360003 | 359991 |
| Quasi univoche | bitmap | 100000 | 97480 | 8 | 900320 | 9.00320 | 170076 | 170064 |
| Molte ambigue | record_pool | 100000 | 147409 | 8 | 2189796 | 21.89796 | 415793 | 415781 |
| Molte ambigue | bitmap | 100000 | 147409 | 8 | 900320 | 9.00320 | 190999 | 190987 |
| Molte vuote | record_pool | 100000 | 45082 | 8 | 1780488 | 17.80488 | 330649 | 330637 |
| Molte vuote | bitmap | 100000 | 45082 | 8 | 900320 | 9.00320 | 159420 | 159408 |
| Dispersi {2,3,7,1000} | record_pool | 100000 | 119901 | 4 | 2079764 | 20.79764 | 354226 | 354214 |
| Dispersi {2,3,7,1000} | bitmap | 100000 | 119901 | 4 | 850256 | 8.50256 | 149285 | 149273 |

| Scenario | Formato | Copia RAM ms | Validazione ms | Caricamento validato ms | 20k query ms | Voce us | Filtro tutte N=2 ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Quasi univoche | record_pool | 2.094 | 1011.944 | 1007.031 | 56.042 | 5.029 | 269.353 |
| Quasi univoche | bitmap | 1.270 | 710.060 | 710.928 | 35.161 | 8.304 | 5.682 |
| Molte ambigue | record_pool | 2.301 | 1069.796 | 1070.242 | 59.390 | 4.959 | 295.736 |
| Molte ambigue | bitmap | 1.116 | 872.175 | 952.267 | 34.879 | 7.856 | 8.433 |
| Molte vuote | record_pool | 1.941 | 965.101 | 970.742 | 46.430 | 5.092 | 220.860 |
| Molte vuote | bitmap | 1.174 | 669.245 | 675.061 | 34.027 | 7.423 | 3.870 |
| Dispersi {2,3,7,1000} | record_pool | 1.984 | 1060.168 | 1244.124 | 86.721 | 7.193 | 291.704 |
| Dispersi {2,3,7,1000} | bitmap | 1.123 | 737.343 | 738.896 | 32.565 | 7.073 | 11.080 |

Le mediane indipendenti oscillano: il caricamento validato puo' risultare
lievemente inferiore alla mediana di sola validazione. Non sono SLA.

| Scenario | Risparmio raw bitmap | Risparmio gzip bitmap | Parole trovate con N=2 |
| --- | --- | --- | --- |
| Quasi univoche | 54.76% | 52.76% | 12343 |
| Molte ambigue | 58.89% | 54.06% | 18411 |
| Molte vuote | 49.43% | 51.79% | 5549 |
| Dispersi {2,3,7,1000} | 59.12% | 57.86% | 29967 |

Esempio puramente teorico, non generazione da dati reali:
N=558124, M=N, K=8 -> record 11162640 byte (10.65 MiB), bitmap
5023440 byte (4.79 MiB), piu' 2232496 byte (2.13 MiB) temporanei per
validare le cardinalita'. Risparmio residente del buffer circa 55%.
Queste cifre non comprendono il vocabolario, trasferimenti JS/WASM,
compressed buffer o copie necessarie al caricamento reale.

## 6. Complessita' futura C++/WASM

| Operazione | Record+pool | Bitmap |
| --- | --- | --- |
| Metadata parola | O(1) | O(1) |
| Appartenenza (i,N) | O(log c_i), ricerca nel pool della parola | O(log K) directory + 1 bit |
| Tutti i conteggi parola | O(c_i) | O(K) |
| Tutte le parole per N | Scansione N record e relativi pool | O(log K + ceil(N/8) + risultati) |
| Validazione | O(N+M), buffer e memoria ausiliaria costante | O(N+K*ceil(N/8)+M), piu' 4*N temporanei |

Nel futuro C++ occorrera' leggere LE senza reinterpret_cast di struct packed,
verificare gli offset uint64 prima di conversioni a size_t WASM32,
controllare overflow, budget RAM e allocazioni. Nessun framework o codec
particolare necessario. Il piccolo indice K puo' restare nel buffer;
il prototipo Python conserva due tuple O(K), non un oggetto per parola.
I 4*N temporanei del validatore vanno liberati prima di usare il runtime.
Il generatore puo' consumare piu' memoria; e' offline e non il caricatore browser.

K conta i valori osservati, non il loro massimo: valori grandi ma pochi non
costano colonne aggiuntive. K molto grande e' invece il limite reale del modello:
per M/N circa 1, il pareggio raw e' intorno a K=96 (overhead esclusi).
Con pochissimi conteggi presenti e K alto, record+pool puo' essere migliore.
Questo non autorizza a imporre un limite linguistico ai conteggi.

## 7. Decisione e perimetro

Raccomandazione: preferire la bitmap per il futuro filtro per N, prima di
congelare v1, se la distribuzione reale autorizzata confermera' K contenuto.
Il vantaggio raw nelle fixture e' significativo, non marginale; l'indice per
N e' gia' la forma naturale del filtro. La ricostruzione O(K) e la validazione
con 4*N temporanei sono costi espliciti ma ragionevoli per K piccolo.
Non congelerei record+pool solo perche' gia' implementato, ne' dichiaro qui
bitmap v1 definitiva senza una verifica successiva dei limiti di risorse.

Nessuna sostituzione del formato e' stata applicata. Una successiva migrazione
approvata riguarderebbe `tools/prepara_runtime_sillabe.py`,
`tools/tests/test_prepara_runtime_sillabe.py`, `tools/sillabe/RUNTIME_SILLABE.md`:
writer, lettore, verificatore manifesto/statistiche, specifica e test.
Non richiede modifiche alla pipeline di annotazione o alla curatela;
nessuna integrazione nel core/web in questa fase.

Creati solo questo documento, `tools/confronta_runtime_sillabe.py` e
`tools/tests/test_confronta_runtime_sillabe.py`.

## 8. Test e integrita' finale

23 test nuovi passati: confronto upstream, esclusione derivata, tutti gli stati,
roundtrip completo, query/filtro, zero parole e zero conteggi, valori uint32
dispersi/UINT32_MAX, 70 colonne, piu' byte per bitmap, determinismo,
hash/snapshot, corruzioni strutturali con checksum ricalcolato, quattro scenari.
Suite completa `python -B -m unittest discover -s tools/tests -q`:
177 test, 174 passati, 3 skip, nessun fallimento (140.392 s).
Skip: runner C++ esterno e audit reale non indicati; symlink senza privilegio
Windows. I primi due non sono stati abilitati per non accedere a dati reali.
I test storici Git usano solo repository temporanei e fixture sintetiche.

HEAD invariato: `8c26f0e73e923cde152e54ac3fafe1ab7630b128`.
`git diff --exit-code` e `git diff --cached --exit-code`: entrambi vuoti.

```text
## main...origin/main
?? tools/confronta_runtime_sillabe.py
?? tools/prepara_runtime_sillabe.py
?? tools/sillabe/CONFRONTO_RUNTIME.md
?? tools/sillabe/RUNTIME_SILLABE.md
?? tools/tests/test_confronta_runtime_sillabe.py
?? tools/tests/test_prepara_runtime_sillabe.py
```

Gli ultimi tre file dell'attivita' precedente (prepara_runtime, sua specifica
e suoi test) erano gia' untracked all'inizio e sono rimasti byte-per-byte
invariati. Confronto SHA-256 iniziale/finale: 59 file protetti, nessuna differenza,
inclusi revisore/PWA, curatela, pipeline, core/web/console/dist e vocabolario.
La curatela reale e' stata soltanto sottoposta a hash per l'integrita',
mai interpretata o usata per generare runtime. dati_locali e backup non letti.
Nessun altro file preesistente modificato. Nessun git add/commit/push/deploy
nel progetto, nessun artifact sillabico reale generato.
