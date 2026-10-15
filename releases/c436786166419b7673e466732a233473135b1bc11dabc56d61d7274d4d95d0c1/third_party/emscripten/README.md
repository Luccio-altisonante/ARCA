# Notice Emscripten della distribuzione ARCA

Versione installata e usata dalla build: **6.0.9**, identificata dal file
`C:\emsdk\upstream\emscripten\emscripten-version.txt`.
Toolchain upstream: [Emscripten 6.0.9](https://github.com/emscripten-core/emscripten/tree/6.0.9).

Questa cartella contiene soltanto copie integrali dei notice, non una copia
della toolchain. Origini nell'installazione `upstream/emscripten/`:

| Copia | File originale |
| --- | --- |
| LICENSE.txt | LICENSE |
| musl-COPYRIGHT.txt | system/lib/libc/musl/COPYRIGHT |
| libcxx-LICENSE.txt | system/lib/libcxx/LICENSE.TXT |
| libcxxabi-LICENSE.txt | system/lib/libcxxabi/LICENSE.TXT |
| compiler-rt-LICENSE.txt | system/lib/compiler-rt/LICENSE.TXT |

Le copie preservano esattamente i byte originali (anche newline), verificabili
con SHA-256 dei due file. LICENSE.txt riporta integralmente MIT e
University of Illinois/NCSA, oltre al notice Node.js del supporto Emscripten.
Gli altri file conservano i termini specifici delle implementazioni collegate.
Non attribuiscono a Emscripten o LLVM l'autorialita' di ARCA.

Quando si aggiorna la toolchain, verificare versione e notice dell'installazione
effettivamente usata e aggiornare esplicitamente queste copie e
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md). La build le distribuisce
nella release immutabile e nel precache senza recuperarle da Internet.
