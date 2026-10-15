# ARCA — Assonanze, Rime, Consonanze e Anagrammi

ARCA è un progetto di **Luca Montanelli** dedicato all'esplorazione strutturale del lessico italiano e alla ricerca di relazioni tra parole.

Il progetto riunisce strumenti per anagrammi, rime, assonanze e consonanze con un ordinamento strutturale originale basato su pivot vocalici, un filtro sillabico, la gestione di un vocabolario personale e un'interfaccia WebAssembly/PWA installabile e utilizzabile offline.

ARCA nasce a partire da *Anagrammi e non solo* di **Carlo Barabucci (2020)**, che costituisce la base storica da cui ha avuto inizio lo sviluppo. A partire da quella base, il progetto è stato ampiamente rielaborato, esteso e sviluppato da **Luca Montanelli**, con l'ausilio di strumenti di intelligenza artificiale di OpenAI.

Lo sviluppo successivo ha introdotto, tra l'altro, la logica di ordinamento strutturale ARCA, il filtro sillabico, la gestione del vocabolario personale, la paginazione, l'architettura WebAssembly/PWA e gli strumenti linguistici e di presentazione che compongono il progetto attuale.

## Crediti e licenze

Rielaborazione, evoluzione e sviluppo del programma originale
*Anagrammi e non solo* di Carlo Barabucci (2020).

Conversione ed evoluzione C++, WebAssembly/PWA, interfaccia, strumenti
linguistici, integrazione e curatela: **Luca Montanelli**, con l'ausilio
di strumenti di intelligenza artificiale di OpenAI.

Il software ARCA e' distribuito sotto **GNU General Public License versione 3
o successiva** (identificatore SPDX: **GPL-3.0-or-later**).
Carlo Barabucci ha confermato questa licenza per il programma originale
*Anagrammi e non solo* (2020) e per le versioni derivate.
Il testo integrale e' in [LICENSE](LICENSE). Software e dati sono distinti: vocabolario
e dataset/runtime sillabico derivato sono distribuiti sotto CC BY-SA 4.0.

- [Crediti principali](CREDITS.md).
- [Dataset del vocabolario](DATASET.md).
- [Dataset sillabico](SILLABE_DATASET.md).
- [Notice dei componenti terzi](THIRD_PARTY_NOTICES.md).

## Struttura

Componenti principali, senza elencare ogni file:

```text
core/
  testo.hpp / testo.cpp
  unicode.hpp / unicode.cpp
  sillabe.hpp / sillabe.cpp
  sha256.hpp / sha256.cpp
  runtime_sillabe.hpp / runtime_sillabe.cpp
  profilo_sillabe.hpp / profilo_sillabe.cpp
  vocabolario.hpp / vocabolario.cpp
  ordinamento_rimario.hpp / ordinamento_rimario.cpp
  anagrammi_indicizzati.hpp
  ricerche.hpp / ricerche.cpp
  comandi.hpp / comandi.cpp
  api.hpp / api.cpp
console/
  main.cpp
  vocabolario_file.hpp / vocabolario_file.cpp
web/
  bindings.cpp, build.ps1
  index.html, app.js, presentazione.js, style.css
  persistenza.js, runtime-sillabe-storage.js
  manifest.webmanifest, service-worker.template.js
  data/, papers/
tools/
  genera_vocabolario_wiktionary.py, genera_vocabolario.ps1
  ordina_vocabolario.cpp
  annota_sillabe.py, prepara_runtime_sillabe.py
  sillabe/, revisore_sillabe/
tests/                  test C++ e JavaScript
third_party/
  utf8proc/, emscripten/
CMakeLists.txt
VocabolarioItaliano.txt
DATASET.md, SILLABE_DATASET.md
```

Il core contiene la logica riutilizzabile e non usa `std::cin`, `std::cout` o
`std::cerr`. La console legge l'input, chiama il core e stampa il risultato.

Il file `core/api.hpp` espone `MotoreAnagrammi`, una piccola API riutilizzata
dalla console e dall'interfaccia WebAssembly/JavaScript. Il
motore possiede il vocabolario in memoria; la console e' responsabile solo di
leggere e salvare `VocabolarioItaliano.txt` su disco.

Le funzioni principali dell'API sono:

```cpp
anagrammi::MotoreAnagrammi motore;
motore.carica_vocabolario_da_testo(testo_del_vocabolario);
auto risultato = motore.esegui_comando("?asa");
auto testo = motore.esegui_comando_testo("*conta*");
motore.aggiungi_parola("parola");
motore.rimuovi_parola("parola");
auto quante = motore.numero_parole();
```

`esegui_comando` restituisce righe, footer, messaggio e informazioni sulla
modifica del vocabolario senza stampare nulla. `esegui_comando_testo` restituisce
una stringa gia' serializzata quando e' piu' comodo trasferire un solo valore.

## Compilazione

Con MinGW/g++:

```powershell
g++ -std=c++17 -O2 -Wall -Wextra -DUTF8PROC_STATIC -Ithird_party/utf8proc console/main.cpp console/vocabolario_file.cpp core/testo.cpp core/unicode.cpp core/sillabe.cpp core/sha256.cpp core/runtime_sillabe.cpp core/profilo_sillabe.cpp core/vocabolario.cpp core/ordinamento_rimario.cpp core/ricerche.cpp core/comandi.cpp core/api.cpp third_party/utf8proc/utf8proc.c -o anagrammi_cpp.exe
```

## Avvio

Dalla cartella principale di ARCA, che contiene `VocabolarioItaliano.txt`, avvia:

```powershell
.\anagrammi_cpp.exe
```

In alternativa puoi passare il percorso del vocabolario
(esempio generico, da sostituire con il proprio percorso):

```powershell
.\anagrammi_cpp.exe C:\percorso\VocabolarioItaliano.txt
```

## Build web distribuibile

Con Emscripten installato e attivato, dalla cartella principale del progetto:

```powershell
.\web\build.ps1
```

Lo script compila WebAssembly e ricrea `dist/` con i soli file statici necessari
alla web app. `dist/` e' un artefatto generato ed e' esclusa da Git.

Per provare esclusivamente la distribuzione generata:

```powershell
python -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Apri `http://127.0.0.1:8000/` nel browser. Non aprire direttamente
`dist/index.html`: WebAssembly e il vocabolario richiedono un server HTTP.

## Uso con Visual Studio Code

Dopo aver clonato o scaricato il repository, apri un terminale nella cartella
principale di ARCA e avvia:

```powershell
code .
```

La compilazione della versione console può essere eseguita dal terminale
con il comando indicato nella sezione **Compilazione**.

Per la versione web usa invece:

```powershell
.\web\build.ps1
```

Il file `VocabolarioItaliano.txt` deve trovarsi nella posizione prevista
dalla modalità di esecuzione scelta; in alternativa la console accetta
il percorso del vocabolario come argomento.

## Dataset linguistico

`VocabolarioItaliano.txt` e' generato in modo riproducibile dai dati di
Wikizionario estratti da Wiktextract/Kaikki. Provenienza, versione, licenza,
filtri, hash e comando di rigenerazione sono documentati separatamente in
[`DATASET.md`](DATASET.md). Il dataset e il codice dell'applicazione sono
componenti distinti.

Il file non e' ordinato alfabeticamente: usa l'ordinamento personalizzato da
rimario del progetto, implementato una sola volta in
`core/ordinamento_rimario.cpp`. Le ricerche mantengono l'ordine del vocabolario;
anche aggiunte e ripristino del vocabolario personale usano lo stesso
comparatore.

## Unicode

Il core mantiene le stringhe alle proprie frontiere in UTF-8 e usa punti di
codice Unicode nelle operazioni linguistiche. `core/unicode.cpp` centralizza
decodifica, codifica, conteggio, lowercase uno-a-uno e normalizzazione NFC.
Accenti diversi restano distinti nelle ricerche; soltanto la chiave separata del
rimario storico tratta le vocali accentate come vocali base.

La normalizzazione usa la libreria vendorizzata utf8proc 2.12.0, distribuita con
licenza MIT/Expat e Unicode Data License. Provenienza e hash dell'archivio sono
documentati in `third_party/utf8proc/README.md`. I byte UTF-8 malformati vengono
sostituiti singolarmente con `U+FFFD`, evitando crash e accessi fuori limite.
Non sono gestiti grapheme cluster complessi.

## Conteggio sillabico

`core/sillabe.hpp` espone `std::size_t anagrammi::conta_sillabe(std::string_view)`.
Il binding WASM espone la funzione libera `modulo.conta_sillabe(parola)`:
non richiede un vocabolario caricato e non aggiunge comandi alla UI o al parser.

Il risultato e' un conteggio ortografico/euristico italiano, non una divisione
in sillabe. Dopo minuscolo e NFC con gli helper Unicode esistenti, ogni gruppo
vocalico vale il numero di a/e/o (anche accentate), con un minimo di 1.
Le i/u con accento esplicito grave, acuto o circonflesso contano anch'esse
come nuclei: `conta_sillabe("bugia")` restituisce la stima 2, mentre
`conta_sillabe(u8"bug\u00eca")` restituisce 3.

Sono riconosciute a/e/i/o/u e le forme precomposte con accento grave, acuto
o circonflesso, comprese le decomposizioni canoniche equivalenti dopo NFC.
Non sono introdotte regole di dieresi e y non e' una vocale.
Stringhe vuote o senza nuclei valgono 0; gli spazi esterni vengono rimossi,
ma whitespace interno produce 0 (questa API accetta una sola parola).
Apostrofi, trattini, cifre, punteggiatura e ogni altro carattere non vocalico
interrompono i gruppi senza aggiungere nuclei. I byte UTF-8 invalidi sono
sostituiti con U+FFFD dagli helper esistenti e interrompono anch'essi i gruppi.
L'input non viene modificato.

Accenti non scritti, iati atoni, omografi e prestiti possono dare risultati
inesatti. Non vengono consultati dizionari runtime ne' trasferiti accenti
fra forme correlate. Il modulo e' indipendente dal rimario; la concordanza
misurata sui corpus non costituisce una garanzia universale di accuratezza.

## Input disponibili

Scrivi un input e premi invio.

| Input | Cosa fa |
| --- | --- |
| `parola` | Cerca gli anagrammi lunghi quanto la parola digitata. |
| `parola N` | Cerca parole di `N` lettere formabili con le lettere digitate; mostra tra parentesi le lettere non usate. Esempio: `cartone 5`. |
| `?asa` | Il `?` sostituisce una lettera qualsiasi nella stessa posizione. Esempio: trova `casa`, `basa`, `rasa`. |
| `*a??a` | `*` e `?` sono cumulabili: trova parole che terminano con `a`, due lettere qualsiasi, `a`; per esempio `arca`, `anta`, `canta`, `incanta`, `costanza`. |
| `conta*` | Trova parole che iniziano con `conta`. |
| `*conta` | Trova parole che finiscono con `conta`. |
| `*conta*` | Trova parole che contengono `conta`. |
| `&sssssss` | Trova parole che contengono tutte le lettere indicate, rispettando anche le ripetizioni. |
| `!abcde` | Trova parole che non contengono nessuna delle lettere indicate. |
| `$abcde` | Trova parole formabili usando solo quelle lettere. |
| `^,10,8` | Mostra 10 parole casuali di 8 caratteri. |
| `+ parola` | Aggiunge `parola` al vocabolario e salva il file. |
| `- parola` | Elimina `parola` dal vocabolario e salva il file. |
| `:help` | Mostra l'aiuto. |
| `:quit` | Esce dal programma. |

I jolly `?` e `*` possono essere combinati nello stesso input. Gli altri jolly
`!`, `&`, `$` e `^` sono pensati come alternative tra loro, come nel programma originale.
