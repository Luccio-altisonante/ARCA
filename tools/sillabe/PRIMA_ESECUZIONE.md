# Prima annotazione offline del vocabolario ufficiale

Data: 2026-10-01. Core di base al checkpoint `dcfacdf` invariato.
Politica `offline-v1-conservativa`, schema 1. Curatela ufficiale inizialmente
vuota: nessuna decisione dell'autore inventata o applicata implicitamente.

## Input e integrita'

- Vocabolario: 558124 grafie, stesso ordine e stessi byte.
  SHA-256: `b3b5703f69874095e9f9ac630ed0a608b919d969d5cd3a6b6477735db8595ad6`.
- Raw Wiktextract locale, dump 2026-09-01:
  `ca3bb0aa07d5730d7a0c7fb106da8e3c9079d598a5914744c803a0f876a429dc`.
- TSV PhonItalia 1.10 locale:
  `22d22409c1fc3ad2844f47543f3017c50ef9d3f95f5196093ff2203d7f071b17`.

Le stime provengono dal runner C++17 compilato dal core corrente, non da
un algoritmo riscritto in Python. Nessun download. Gli output estesi non
sono nel repository: directory temporanea `anagrammi-annotazioni-07b522ba-ufficiale`.
Il manifesto identifica tutti gli input e gli artefatti con hash.

## Classificazione completa

| Stato | Grafie |
|---|---:|
| RISOLTO automaticamente | 104332 |
| AMBIGUO, corroborato automaticamente | 2 |
| CONFLITTO | 1042 |
| SOLO_STIMA | 445697 |
| DA_RIVEDERE | 7051 |
| ESCLUDI ufficiale, pendente | 0 |
| Totale | 558124 |

RISOLTO non significa curatela verificata: i motivi distinguono due fonti
concordanti da una fonte univoca che coincide con R1. Nessun record e'
marcato come decisione manuale in questa esecuzione.

## Copertura e revisione

| Evidenza sillabica utilizzabile | Grafie |
|---|---:|
| Wiktionary | 83087 |
| PhonItalia | 69575 |
| Entrambe | 41260 |
| Almeno una | 111402 |

Copertura per grafia del vocabolario, non per record raw o flessione dedotta.
I conteggi multipli delle fonti sono conservati, non scartati dalla copertura.

La coda contiene **453792** record realmente non risolti: **8095 prioritari**
(1042 conflitti, 7051 sospetti/incompleti e 2 ambiguita' da confermare), piu'
**445697 sole stime** da non spacciare per dati verificati. La priorita' non
elimina il lavoro restante; l'assenza di fonti non prova correttezza di R1.

Wiktionary: 101954 sillabazioni valide, 1155 scartate come incomplete o
incompatibili, 164627 segnaposto di sillabazione esplicitamente mancante.
Questi ultimi sono assenza di dati, non falsi allarmi da revisionare prima.

## Distribuzione dei conteggi

I conteggi finali singoli includono stime e dati da rivedere con una fonte
univoca: NON sono tutti conteggi ufficialmente verificati. R1 resta separato.

| Sillabe | Conteggi singoli scelti | Stime R1 originali |
|---|---:|---:|
| 0 | 0 | 286 |
| 1 | 858 | 1001 |
| 2 | 15957 | 16818 |
| 3 | 94546 | 96605 |
| 4 | 200660 | 201448 |
| 5 | 163718 | 162901 |
| 6 | 63066 | 62454 |
| 7 | 14133 | 13896 |
| 8 | 2424 | 2364 |
| 9 | 331 | 303 |
| 10 | 45 | 34 |
| 11 | 7 | 6 |
| 12 | 6 | 7 |
| 13 | 1 | 1 |
| 15 | 1 | 0 |

555753 conteggi singoli, 2 record con [2,3], 2369 senza conteggio deciso.
La somma e' 558124. Nessuna attribuzione numerica arbitraria ai conflitti.

## Esempi rappresentativi

| Parola | R1 | Wiktionary | PhonItalia | Risultato automatico |
|---|---:|---|---|---|
| casa | 2 | [2] | [2] | RISOLTO [2] |
| paura | 2 | [3] | [3] | RISOLTO [3] |
| via | 1 | [2] | [2] | RISOLTO [2] |
| zio | 1 | [2] | [2] | RISOLTO [2] |
| farmacia | 3 | [4] | [4] | RISOLTO [4] |
| regia | 2 | [2,3] | [2,3] | AMBIGUO [2,3] |
| balia | 2 | [2,3] | [2,3] | AMBIGUO [2,3] |
| bugia | 2 | [3] | [2] | CONFLITTO, nessuna alternativa ufficiale |
| viola | 2 | [3] | [2,3] | CONFLITTO conservativo, da curare |
| circuito | 3 | [3,4] | [4] | CONFLITTO conservativo, da curare |
| baby | 1 | [2] | [] | DA_RIVEDERE, candidato lessicale [2] |
| ab- | 1 | [] | [] | SOLO_STIMA [1] |

Il criterio volutamente conservativo non trasforma ogni divergenza in vera
ambiguita'. `viola` e `circuito` richiedono una decisione ufficiale esplicita
per diventare AMBIGUI in questo dataset. Il consenso puo' contenere errori
condivisi: ad esempio le due fonti danno 4 per `gratuito`, R1 3. Nessuna
eccezione lessicale e' aggiunta; la futura curatela puo' correggere il dato.

## Curatela e prossimo revisore

La politica superiore e' implementata e testata: una scelta dell'autore
conservata per parola sostituisce il risultato finale, lasciando visibili
la stima, le fonti e la classificazione automatica originali. Rigenerare
con nuove evidenze non riscrive la curatela. Solo una modifica esplicita
di quest'ultima puo' cambiare o revocare una scelta ufficiale.

Il futuro revisore leggera' la coda e i raw identificati dal manifesto,
mostrera' i testimoni delle fonti e la decisione eventualmente gia' presente,
e salvera' numero, alternative, rinvio o esclusione nella mappa ufficiale
con autore/data/motivazione. Nessuna interfaccia interattiva o override
personale implementati in questa fase. Per formato, comandi e proposta
runtime compatta vedere `README.md` in questa stessa directory.

## Verifiche

- 18 test offline superati, incluse rigenerazioni con stime alterate e
  precedenza delle decisioni CONFERMA, AMBIGUO, DA_RIVEDERE ed ESCLUDI.
- Runner e test sillabe correnti compilati con C++17; test sillabe superato.
- Tutti i 558124 indici e le grafie verificati contro il vocabolario originale;
  coda e statistiche coerenti; hash degli artefatti verificati.
- File preesistenti del progetto invariati; soltanto nuovi strumenti,
  test e documenti sotto tools/. Nessun commit, push o deploy.
- CTest non rieseguito: CMake/CTest non piu' disponibili nel percorso della
  precedente build temporanea. Nessuna installazione eseguita per sostituirli.
