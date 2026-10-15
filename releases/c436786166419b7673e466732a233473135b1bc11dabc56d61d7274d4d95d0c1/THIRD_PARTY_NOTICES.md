# Software e componenti di terze parti

Questi notice riguardano software effettivamente incorporato o supporto runtime
della build. Non attribuiscono a tali componenti l'autorialita' di ARCA.
Crediti del progetto e licenza software: [CREDITS.md](CREDITS.md).

## utf8proc 2.12.0

Sorgenti originali vendorizzati da [JuliaStrings/utf8proc](https://github.com/JuliaStrings/utf8proc),
tag [v2.12.0](https://github.com/JuliaStrings/utf8proc/releases/tag/v2.12.0).
Autori: Public Software Group, Jan Behrens, Steven G. Johnson e gli altri
contributori identificati nel notice originale.
Licenza software **MIT/Expat**; i dati Unicode incorporati hanno la
**Unicode Data License** riportata nello stesso file.

SHA-256 archivio registrato nella provenienza vendorizzata:
`f564011d38b2888d583d510b08e69ffa15aa117155db1b9b49ef1dfe1fa25111`.
Questo e' l'hash documentato dell'archivio sorgente usato, non il digest
dell'asset tar.gz pubblicato separatamente nella release GitHub.
[Provenienza locale](third_party/utf8proc/README.md).
[Testo integrale originale e invariato](third_party/utf8proc/LICENSE.md),
comprensivo dei notice MIT/Expat e Unicode, distribuito anche offline.

## Emscripten 6.0.9

Toolchain C++/WebAssembly e supporto runtime del JavaScript generato,
**non autore di ARCA**. Licenza duale **MIT / University of Illinois-NCSA**.
Versione rilevata da `emscripten-version.txt` nell'installazione EMSDK usata
da `web/build.ps1` (`C:\emsdk\upstream\emscripten`, default della build).
Il file LICENSE ufficiale e' copiato senza modifiche dall'installazione:
[LICENSE Emscripten](third_party/emscripten/LICENSE.txt).
Include anche il notice per porzioni Node.js usate dal supporto Emscripten:
non significa che Node.js venga eseguito nel browser.
[Provenienza e controllo dei byte](third_party/emscripten/README.md).

### Supporto binario effettivamente collegato

La build C++ con eccezioni incorpora implementazioni fornite dall'EMSDK:

- musl libc: MIT, Rich Felker e contributori;
  [COPYRIGHT originale](third_party/emscripten/musl-COPYRIGHT.txt).
- LLVM libc++, libc++abi e compiler-rt: i LICENSE installati includono
  Apache 2.0 con LLVM Exceptions e i termini storici duali MIT/NCSA;
  [libc++](third_party/emscripten/libcxx-LICENSE.txt),
  [libc++abi](third_party/emscripten/libcxxabi-LICENSE.txt),
  [compiler-rt](third_party/emscripten/compiler-rt-LICENSE.txt).

Sono notice delle implementazioni realmente collegate nel WASM, non crediti
generici per la libreria standard o per tutti gli strumenti installati.
I testi sono copie integrali dei file dell'EMSDK 6.0.9, senza riscritture.
L'allocatore predefinito dlmalloc di Doug Lea e' rilasciato nel pubblico dominio
(CC0, come indicato in `system/lib/dlmalloc.c` dell'EMSDK).

## Fonti e strumenti della pipeline dati offline

Wikizionario, Wiktextract/Kaikki, PhonItalia/phonItaliaR e WikiPron sono
fonti o strumenti offline della pipeline linguistica, **non librerie
JavaScript distribuite nella PWA**. Le attribuzioni e licenze dei contenuti
sono in [DATASET.md](DATASET.md) e [SILLABE_DATASET.md](SILLABE_DATASET.md).
In particolare Apache 2.0 del software WikiPron non e' la licenza dei TSV
linguistici derivati da Wiktionary.
