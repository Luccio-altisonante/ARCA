# Dataset del vocabolario italiano

`VocabolarioItaliano.txt` e' un dataset linguistico derivato da Wikizionario e
non e' un'opera originale esclusiva degli autori dell'applicazione.

## Provenienza

- Fonte: [Wikizionario in italiano](https://it.wiktionary.org/).
- Estrazione strutturata: [Wiktextract](https://github.com/tatuylonen/wiktextract)
  tramite [Kaikki.org](https://kaikki.org/itwiktionary/rawdata.html).
- File sorgente:
  `https://kaikki.org/itwiktionary/raw-wiktextract-data.jsonl.gz`.
- Dump di Wikizionario: 2026-09-01.
- Estrazione Kaikki/Wiktextract: 2026-09-24.
- Data del download usato per questo file: 2026-09-28.
- SHA-256 del file `.jsonl.gz` usato:
  `ca3bb0aa07d5730d7a0c7fb106da8e3c9079d598a5914744c803a0f876a429dc`.
- SHA-256 di `VocabolarioItaliano.txt`:
  `b3b5703f69874095e9f9ac630ed0a608b919d969d5cd3a6b6477735db8595ad6`.

L'URL del download indica la versione corrente e puo' cambiare nel tempo. Data,
versione e hash qui sopra identificano esattamente la sorgente usata per il file
incluso in questa revisione.

## Licenza e attribuzione

Il testo dei progetti Wikimedia e' disponibile secondo la
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) e la
[GNU Free Documentation License](https://www.gnu.org/licenses/fdl-1.3.html),
come descritto nelle
[condizioni d'uso Wikimedia](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use#7._Licensing_of_Content).

Questa lista derivata viene distribuita secondo la **CC BY-SA 4.0**. Le
attribuzioni agli autori delle voci originali sono disponibili nelle cronologie
delle pagine di Wikizionario. La licenza del dataset non si applica
automaticamente al codice indipendente dell'applicazione: codice e dati restano
componenti distinti.

## Generazione

La pipeline riproducibile richiede Python 3.10 o successivo e un compilatore
`g++` con supporto C++17, senza librerie esterne. Accetta sia JSONL sia
JSONL.GZ e si esegue con un solo comando dalla cartella del progetto:

```powershell
.\tools\genera_vocabolario.ps1 `
  C:\percorso\raw-wiktextract-data.jsonl.gz
```

Lo script PowerShell coordina due componenti distinte:

1. `genera_vocabolario_wiktionary.py` legge il dump in streaming, un oggetto
   JSON per riga;
2. considera soltanto i record con `lang_code` uguale a `it`;
3. estrae esclusivamente `word` e ogni `forms[].form`;
4. elimina gli spazi esterni, converte in minuscolo e normalizza in NFC;
5. scarta valori vuoti, caratteri di controllo, forme prive di qualunque
   lettera Unicode, forme che contengono whitespace interno e forme che
   contengono i caratteri riservati `? * $ ! & ^ % ,`;
6. elimina i duplicati e scrive un file intermedio deterministico;
7. compila ed esegue `tools/ordina_vocabolario.cpp`, che usa il comparatore
   condiviso in `core/ordinamento_rimario.cpp`;
8. scrive il risultato UTF-8 senza BOM, una forma per riga e con terminatori
   LF, insieme a un report JSON.

`VocabolarioItaliano.txt` non e' alfabetico. E' ordinato secondo il particolare
ordinamento da rimario storico del progetto: le vocali accentate italiane
comuni sono confrontate come vocali base, i segmenti sono esaminati a ritroso
secondo i pivot legacy e le voci senza vocali sono collocate in fondo. Questo
ordinamento e' una trasformazione effettuata dal progetto e non cambia la
provenienza o la licenza dei dati.

Non vengono lette definizioni, traduzioni, esempi o relazioni lessicali. Le
forme con whitespace sono escluse per mantenere soltanto forme singole. Le forme
con `? * $ ! & ^ % ,` sono escluse come filtro tecnico per evitare collisioni
con la sintassi dei comandi dell'applicazione. Accenti, apostrofi e trattini
sono conservati.

## Statistiche della versione inclusa

- Record JSONL totali: 801.663.
- Record italiani: 560.588.
- Candidati da `word`: 560.588.
- Candidati da `forms[].form`: 713.973.
- Candidati esclusi per assenza di lettere: 61.
- Occorrenze candidate escluse per whitespace: 268.150.
- Forme uniche escluse per whitespace: 218.496.
- Occorrenze candidate escluse per caratteri riservati: 8.
- Forme uniche escluse per caratteri riservati: 8 (`a&b`, `a&bc`, `a&i`,
  `a&p`, `bagnata,`, `maria!`, `play!`, `r&b`).
- Forme uniche finali: 558.124.
- Forme accentate: 33.094.
- Forme con apostrofo: 88.
- Forme con trattino: 793.
- Forme con whitespace: 0.
- Dimensione del file: 6.585.461 byte.

I 61 elementi esclusi sono segnaposto o valori non lessicali composti soltanto
da punteggiatura o cifre, ad esempio `-`, `...` e numeri isolati.

## Limiti noti

La copertura dipende dalla completezza e dalla qualita' delle voci e delle
tabelle flessive presenti su Wikizionario al momento del dump. Non tutti i
lemmi hanno paradigmi completi; forme rare, regionali o specialistiche possono
mancare o essere classificate in modo non uniforme. Al contrario, il dataset
puo' includere locuzioni, sigle, nomi propri e varianti storiche presenti nella
fonte.

Il dataset e' UTF-8 normalizzato in NFC. Il core C++ conta e confronta punti di
codice Unicode, quindi lettere accentate precomposte valgono un carattere e
restano distinte dalle vocali non accentate. Non vengono implementati grapheme
cluster completi: sequenze come emoji composte o lettere con piu' segni
combinanti possono quindi contare come piu' punti di codice.

## Documenti collegati

La provenienza del dataset/runtime sillabico derivato e le relative attribuzioni
sono in [SILLABE_DATASET.md](SILLABE_DATASET.md).
I [crediti e lo stato della licenza software](CREDITS.md) sono distinti dalle
licenze dei dati: CC BY-SA 4.0 non si applica automaticamente al codice indipendente.
