# Dataset e runtime sillabico ARCA

## Distribuzione identificata

Questo documento identifica il runtime realmente distribuito, non un output
automatico precedente. Fonte dei metadata: `web/data/runtime-sillabe.manifest.json`
(schema 1, `disponibile: true`).

- Formato: `sillabe-bitmap-le-v1` (BITMAP-V1).
- Artifact: `runtime-sillabe-2c1cfababd7a21373fdb7ad221d0e0da26f1de17e2d7a74b6ce59a242978429d.bin`.
- SHA-256 artifact: `2c1cfababd7a21373fdb7ad221d0e0da26f1de17e2d7a74b6ce59a242978429d`.
- Dimensione: 5.372.350 byte; grafie: 558.124.
- SHA-256 vocabolario: `b3b5703f69874095e9f9ac630ed0a608b919d969d5cd3a6b6477735db8595ad6`.
- SHA-256 annotazioni JSONL: `35c428b9a948bb9f49a2a71de9636cdce6c278261c2875a91af76049f83f1bc6`.
- Curatela: `tools/sillabe/curatela_ufficiale.json`, schema 1;
  SHA-256 `55bc7a4b895f14686197eb2b08216a5bdab3384bae7fac7f6ab5336054695368`.
- Decisioni manuali: 13.704 (12.772 CONFERMA, 924 AMBIGUO, 8 ESCLUDI).

Gli indici zero-based seguono esattamente lo snapshot e l'ordine del vocabolario.
Gli hash del vocabolario e delle annotazioni identificano i byte degli input,
non una loro riserializzazione. Il runtime non contiene una tabella delle grafie.

## Wikizionario / Wiktextract / Kaikki

Vocabolario ed evidenze di sillabazione e pronuncia derivano da
[Wikizionario](https://it.wiktionary.org/), estratto con
[Wiktextract](https://github.com/tatuylonen/wiktextract) tramite
[Kaikki](https://kaikki.org/itwiktionary/rawdata.html).

Lo snapshot e' quello di [DATASET.md](DATASET.md): dump 2026-09-01,
estrazione Kaikki/Wiktextract 2026-09-24, download usato 2026-09-28;
URL sorgente `https://kaikki.org/itwiktionary/raw-wiktextract-data.jsonl.gz`,
SHA-256 del JSONL.GZ
`ca3bb0aa07d5730d7a0c7fb106da8e3c9079d598a5914744c803a0f876a429dc`.
L'URL corrente puo' cambiare: questi metadata, non l'URL da solo, identificano
l'input. Il vocabolario derivato e' distribuito sotto CC BY-SA 4.0.
L'attribuzione dei contributori delle voci e' nelle cronologie Wikizionario.

La pipeline sillabica usa `hyphenations.parts` e `sounds.ipa` dei record italiani,
associati alla grafia esatta normalizzata; non trasferisce automaticamente
pronunce dal lemma alle forme flesse.

## PhonItalia

**PhonItalia 1.10**, corpus di **Jeremy Goslin, Claudia Galluzzi e Cristina Romani**,
tramite il package **phonItaliaR 1.0.0 di Stefano Coretta**;
[provenienza e documentazione ufficiale](https://stefanocoretta.github.io/phonItaliaR/),
[licenza CC BY 4.0](https://stefanocoretta.github.io/phonItaliaR/LICENSE.html).
Coretta ha aggiunto trascrizioni fonemiche nel package.

Riferimento: Goslin, J., Galluzzi, C. e Romani, C. (2014).
*PhonItalia: a phonological lexicon for Italian*. Behavior Research Methods,
46, 872-886. [DOI: 10.3758/s13428-013-0400-8](https://doi.org/10.3758/s13428-013-0400-8).

Il TSV esterno usato dalla pipeline ha SHA-256
`22d22409c1fc3ad2844f47543f3017c50ef9d3f95f5196093ff2203d7f071b17`,
come documentato in `tools/sillabe/SECONDA_ESECUZIONE.md`.
La pipeline usa `SumSylls`, normalizza la grafia/indicazioni di accento e
conserva analisi alternative; i duplicati grammaticali non sono voti aggiuntivi.

## WikiPron

TSV italiano broad `data/scrape/tsv/ita_latn_broad.tsv`, fissato al commit
`960eba421beae7ded634f545b98922fa03e6b19f`:
[sorgente fissata](https://github.com/CUNY-CL/wikipron/blob/960eba421beae7ded634f545b98922fa03e6b19f/data/scrape/tsv/ita_latn_broad.tsv).
SHA-256 documentato dalla pipeline:
`b81cc2c901b685de08f1a4428de36f39cd7b0d59fee15f7c6000f1e61a1f75a2`.

Il **software WikiPron e' Apache 2.0**. Il **TSV linguistico deriva da
Wiktionary, non e' dichiarato Apache 2.0**: attribuzioni e condizioni del
contenuto restano quelle Wiktionary. Vedere
[WikiPron](https://github.com/CUNY-CL/wikipron) e
[Wiktionary:Copyrights](https://en.wiktionary.org/wiki/Wiktionary:Copyrights).
Le cronologie delle voci identificano i contributori del contenuto originale.

Riferimento: Jackson L. Lee, Lucas F. E. Ashby, M. Elizabeth Garza,
Yeonju Lee-Sikka, Sean Miller, Alan Wong, Arya D. McCarthy e Kyle Gorman (2020).
*Massively Multilingual Pronunciation Mining with WikiPron*. LREC 2020,
4223-4228. [PDF originale, titolo Mining](https://aclanthology.org/2020.lrec-1.521v1.pdf).
Il catalogo ACL attuale riporta anche il titolo aggiornato "Modeling";
qui si cita il titolo del PDF originale del lavoro richiesto.

## Trasformazioni e curatela ARCA

La pipeline `offline-v2-evidenze` combina i segnali Wikizionario/WikiPron
(una famiglia), PhonItalia (seconda famiglia), la stima euristica C++ `conta_sillabe()`
(R1) e le decisioni manuali ufficiali. Non e' una votazione fra tre dizionari.
Normalizzazione, interpretazione conservativa IPA, aggregazione delle evidenze,
classificazione, curatela e conversione bitmap sono trasformazioni del progetto.
La curatela ufficiale di Luca Montanelli prevale sull'automatismo e fa parte
del dataset derivato; ESCLUDI conserva l'indice ma non attribuisce conteggi
compatibili, senza rimuovere la grafia dal vocabolario generale.

La rappresentazione finale conserva conteggi possibili, stato, origine e R1.
RISOLTO/STIMA_CORROBORATA/SOLO_STIMA hanno un conteggio; AMBIGUO almeno due;
CONFLITTO/DA_RIVEDERE/ESCLUDI nessuno. R1 resta una stima, non una garanzia.
La generazione e il formato sono descritti in `tools/sillabe/README.md` e
`tools/sillabe/RUNTIME_SILLABE.md` nel repository sorgente.

## Licenza del dataset derivato

Il dataset sillabico derivato e il runtime distribuiti da ARCA sono sotto
**[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)**, per prudenza
e coerenza con i contenuti Wikizionario/Wiktionary. Si conservano le attribuzioni
e le condizioni delle fonti sopra, inclusa PhonItalia CC BY 4.0. Le trasformazioni
e la curatela ARCA non fanno diventare i contenuti originali opere esclusive del
progetto. Il materiale e' fornito senza garanzia di correttezza linguistica.

La distribuzione web contiene il vocabolario derivato e l'artifact bitmap,
**non i raw Wiktextract, il TSV PhonItalia o il TSV WikiPron**. Le fonti sono
input offline, non dipendenze JavaScript incluse nella PWA.
Questa dichiarazione non cambia automaticamente la licenza del codice
indipendente: vedere [CREDITS.md](CREDITS.md) e [DATASET.md](DATASET.md).
