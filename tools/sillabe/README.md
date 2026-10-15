# Pipeline offline di annotazione sillabica v2

Strumenti OFFLINE, non runtime. Non modificano vocabolario, curatela, core,
rimario, web, console, persistenza o WASM. Nessun download automatico.
Python 3.10+ e sola libreria standard; runner C++17 con utf8proc vendorizzato.

Politica: `offline-v2-evidenze`.
Schemi indipendenti: curatela **1**, annotazioni **2**, manifesto **2**.
La curatela schema 1 esistente resta valida e non viene migrata o riscritta.

## Input e provenienza

- Vocabolario originale: ordine invariato, grafie canoniche NFC/minuscole
  con accenti; duplicati, whitespace e grafie non canoniche sono rifiutati.
- Runner C++ corrente: esegue `conta_sillabe()`, senza reimplementazione R1
  in Python. Eseguibile e otto sorgenti verificati tramite manifesto di build;
  binario alterato, sorgenti incompleti o runner obsoleto sono rifiutati.
- Raw Wiktextract locale, italiano: una sola lettura per sillabazioni
  `hyphenations.parts` e `sounds.ipa`. Solo grafia `word` esatta di record
  `lang_code=it`; nessuna propagazione a flessioni o grafie senza accento.
- PhonItalia 1.10: TSV esterno del package phonItaliaR 1.0.0, Stefano Coretta;
  autori Goslin, Galuzzi, Romani. CC BY 4.0.
  [Provenienza](https://stefanocoretta.github.io/phonItaliaR/).
  `SumSylls` e' il conteggio. Apostrofo dopo vocale finale interpretato come
  accento; e/o chiuse diventano acute secondo `Phones`. Duplicati
  grammaticali non diventano voti aggiuntivi.
- WikiPron italiano broad: TSV ESTERNO senza header, due colonne grafia/IPA
  segmentato da spazi. Commit bloccato
  `960eba421beae7ded634f545b98922fa03e6b19f`;
  SHA-256 `b81cc2c901b685de08f1a4428de36f39cd7b0d59fee15f7c6000f1e61a1f75a2`.
  Un altro hash e' rifiutato: aggiornare la risorsa richiede verifica esplicita,
  non sostituzione silenziosa con il file corrente upstream.
  [TSV ufficiale fissato](https://github.com/CUNY-CL/wikipron/blob/960eba421beae7ded634f545b98922fa03e6b19f/data/scrape/tsv/ita_latn_broad.tsv).
- Curatela ufficiale schema 1, indicizzata per parola, letta soltanto.
- Facoltativamente `--precedente`: annotazioni JSONL della prima esecuzione;
  tutte le grafie e gli indici devono essere allineati, senza righe mancanti
  o extra. Confronto streaming e campioni, senza modificare gli output v1.

Il manifesto conserva percorso, byte, SHA-256, versione/provenienza,
macro-famiglia e nota licenza delle fonti. Identifica anche parser, audit,
pipeline, runner/build, vocabolario, curatela e baseline eventuale.
Gli hash vengono ricontrollati prima di pubblicare gli output.
Per il dump ufficiale gia' usato: 2026-09-01, SHA-256
`ca3bb0aa07d5730d7a0c7fb106da8e3c9079d598a5914744c803a0f876a429dc`.

### Licenze dei dati

Il codice WikiPron e' Apache 2, ma il TSV deriva da Wiktionary e **NON e'
Apache 2**. Attribuzione, licenza del contenuto e condizioni di redistribuzione
vanno conservate separatamente dal software; vedere
[WikiPron](https://github.com/CUNY-CL/wikipron) e
[Copyright Wiktionary](https://en.wiktionary.org/wiki/Wiktionary:Copyrights).
Per Wikizionario/Kaikki vedere anche `DATASET.md` nella radice.
Nessun raw, TSV o grande output viene vendorizzato; nessuna modifica alla
licenza generale del progetto. Prima di redistribuire annotazioni o un
pacchetto per il revisore, completare attribuzione e verifica delle condizioni
dei dati derivati. Un hash attesta i byte, non concede diritti.

## Parser IPA e limiti

`tools/evidenze_ipa.py`, versione `ipa-v2-conservativo-2`:
- interpreta vocali IPA, accento primario/secondario, j/w consonantici,
  U+032F non sillabico, U+0329 sillabico e legature consonantiche;
  il ':' dopo un segmento e' accettato come notazione della lunghezza,
  come U+02D0: non aggiunge nuclei; isolato o iniziale resta malformato;
- conserva insiemi di conteggi alternativi e un testimone per conteggio;
- accetta alternative delimitate /.../, /.../ oppure [...]; verifica
  delimitatori, simboli, segni sillabici e trascrizioni incomplete;
- non espande segmenti opzionali o testo editoriale; registra anomalie,
  senza inventare una pronuncia certa;
- conta spazi come separatori di fonemi, NON come confini sillabici;
- segnala vocali adiacenti con i/u deboli non disambiguate da accento,
  confine sillabico o marcatura esplicita. Il numero eventualmente estratto
  e' un candidato incerto e resta visibile, non una certificazione.

E' un interprete conservativo dell'IPA, non un nuovo sillabatore ortografico.
Non pretende di risolvere ogni convenzione editoriale o prestito.
Non usa eccezioni per parole specifiche. Testimoni delle anomalie limitati
a 240 caratteri; i raw completi restano esterni, rintracciabili per hash/riga.
Le alternative significative per il conteggio non sono ridotte ad una sola;
pronunce diverse con stesso numero possono condividere il testimone.

Sillabazioni Wiktionary: parti devono ricomporre la grafia (accents ignorati
solo in questa verifica); dati incompatibili/incompleti sono anomalie.
Il segnaposto "divisione in sillabe mancante" resta assenza dichiarata,
non malformazione e non motivo per gonfiare la coda prioritaria.

## Famiglie e classificazione

Famiglie lessicali:
1. Wiktionary: sillabazioni, IPA locale, WikiPron.
2. PhonItalia.

R1 e' un algoritmo euristico, NON una terza famiglia lessicale.
Unione dei candidati nella famiglia Wiktionary senza contare i segnali come
voti indipendenti. Analisi disgiunte nella stessa famiglia sono un conflitto.
Una fonte che attesta solo un sottoinsieme delle alternative di un'altra non
nega necessariamente le restanti; non si sceglie il sottoinsieme come vincitore.
Due famiglie con insiemi diversi restano in conflitto anche con sovrapposizione.
Un contrasto hyphenation Wiktionary/PhonItalia gia' presente non viene cancellato
dal fatto che nuovi segnali amplino l'unione Wiktionary fino a uguagliare
PhonItalia: rimane CONFLITTO, non ambiguita' costruita dall'aggregazione.

Precedenza: **curatela ufficiale > evidenza forte > stima corroborata > sola stima**.
Una decisione ufficiale prevale anche su fonte nuova, algoritmo futuro o
conflitto automatico; automatico ed evidenze restano leggibili nel record.

- `RISOLTO` automatico: due famiglie lessicali con stesso unico conteggio,
  senza anomalie rilevanti. R1 puo' divergere. Non significa curato dall'autore.
- `STIMA_CORROBORATA`: una sola famiglia univoca coincide con R1, senza
  anomalie rilevanti o evidenza contraria. Restano motivo, nomi dei segnali
  corroboranti e `macro_famiglie_indipendenti=1`. Non equivale a certezza.
- `SOLO_STIMA`: R1 positivo, nessuna evidenza lessicale utile o anomalia.
- `CONFLITTO`: incompatibilita' nella famiglia Wiktionary o fra le due
  famiglie; nessun conteggio finale scelto, candidati conservati.
- `AMBIGUO`: stessi conteggi alternativi nelle due famiglie, almeno un
  segnale Wiktionary che attesta l'intero insieme, analisi PhonItalia
  distinte e nessuna anomalia rilevante. Sempre da confermare se automatico.
  La sola discordanza di fonti non costruisce un'ambiguita'.
- `DA_RIVEDERE`: anomalie rilevanti, R1 nullo, evidenza incompleta,
  alternative non corroborate o unico conteggio lessicale diverso da R1.
  `conteggi=[]`, candidati nelle evidenze: la v1 riportava anche un candidato
  lessicale non confermato nel campo finale; v2 evita questa confusione.
- `ESCLUDI`: soltanto curatela esplicita, esclusione pendente.
  Non elimina la grafia da `VocabolarioItaliano.txt`.

Eccezione di confidenza GENERALE e documentata, non lista di parole:
l'unica anomalia `vocali_adiacenti_non_disambiguate` di un nuovo segnale IPA
non demolisce un consenso W-hyphenation/PhonItalia gia' concordante e privo
di anomalie, se tutti i candidati IPA sono compresi in quell'insieme.
Il dubbio resta visibile in `avvertenze_compatibili_con_consenso_preesistente`.
Non vale per nuove promozioni basate sull'IPA dubbio, materiale malformato o
candidati esterni al consenso. Non protegge altre anomalie.
Nessun TeX/LibreOffice/eSpeak/gruut viene utilizzato per classificare.

## Curatela ufficiale

`curatela_ufficiale.json` resta schema 1, tipo `curatela_ufficiale`,
mappa `decisioni` indicizzata per grafia canonica:
- `CONFERMA`: un intero positivo;
- `AMBIGUO`: almeno due interi positivi ordinati distinti;
- `DA_RIVEDERE`, `ESCLUDI`: lista vuota;
- `autore`, `data` ISO e `motivazione` obbligatori.

Booleani come numeri, chiavi duplicate, grafie non canoniche e dati incompleti
sono rifiutati. Non si impone un limite di un byte ai conteggi offline.
`CONFERMA` manuale appare come `RISOLTO` con origine/precedenza
`curatela_ufficiale`, non come RISOLTO automatico. Correggibile soltanto
tramite successiva modifica esplicita della curatela.
Decisioni fuori vocabolario conservate/segnalate, non cancellate.
La [curatela ufficiale versionata](curatela_ufficiale.json) contiene le decisioni
manuali approvate dall'autore; la pipeline le applica con precedenza sui
risultati automatici. Le fixture dei test restano distinte dalla curatela reale.
Nessun override personale del browser implementato.

## Esecuzione

Dalla radice; scegliere directory NUOVE, esterne al repository. I percorsi
`C:/percorso/...` sono esempi da sostituire con i propri input esterni.
I raw e i TSV non sono distribuiti nel clone. `--precedente` e' facoltativo:
usarlo soltanto se si possiede una precedente esecuzione da confrontare.

```powershell
& ./tools/compila_conta_sillabe.ps1 -OutputDirectory "$env:TEMP/anagrammi-v2-build"
python -B ./tools/annota_sillabe.py `
  --wiktionary "C:/percorso/raw-wiktextract-data-2026-09-01.jsonl.gz" `
  --phonitalia "C:/percorso/phonItalia-1.10-wordforms.tsv" `
  --wikipron "C:/percorso/ita_latn_broad.tsv" `
  --runner "$env:TEMP/anagrammi-v2-build/conta_sillabe_batch.exe" `
  --output "$env:TEMP/anagrammi-annotazioni-v2"
python -B -m unittest discover -s ./tools/tests -p 'test_annota_sillabe.py' -v
```

La funzione Python accetta WikiPron assente per fixture/esecuzioni ridotte;
la CLI pubblica lo richiede con l'hash ufficiale fissato.
Per i due test opzionali su runner reale e seconda esecuzione:

```powershell
$env:ANAGRAMMI_RUNNER = "$env:TEMP/anagrammi-v2-build/conta_sillabe_batch.exe"
$env:ANAGRAMMI_AUDIT_V2 = "$env:TEMP/anagrammi-annotazioni-v2/confronto_prima.json"
python -B -m unittest discover -s ./tools/tests -p 'test_annota_sillabe.py' -v
```

## Artefatti schema 2 (sempre esterni)

- `annotazioni.jsonl`: tutte le parole, ordine originale, indice zero-based
  accessorio; versione/politica, R1, quattro segnali, macro-famiglie,
  automatico/motivo/corroborazioni/anomalie, risultato/origine/manuale,
  esclusione pendente, necessita' e priorita' di revisione.
- `revisione_prioritaria.jsonl`: conflitti, anomalie, DA_RIVEDERE e
  ambiguita' automatiche non confermate dall'autore.
- `stime_non_verificate.jsonl`: SOLO_STIMA, per audit/campioni, non obbligo
  di revisionare ciascuna forma individualmente.
- `stime_corroborate.jsonl`: STIMA_CORROBORATA, separate dalle prioritarie
  e dalle sole stime. Sono ancora da verificare, non dati ufficiali curati.
- `esclusioni_in_attesa.jsonl`, `decisioni_fuori_vocabolario.json`.
- `statistiche.json`: stati automatici/finali, origini, code, coperture,
  sovrapposizioni, famiglie, anomalie, distribuzioni e riepilogo confronto.
- `confronto_prima.json`: matrice esatta delle transizioni, benchmark
  consenso/vecchi RISOLTO/DA_RIVEDERE univoci e tutti i 21 controlli reali.
- `campioni_stratificati.json`: fino a otto minimi SHA-256(parola) per strato
  di tipo grafico/fonte/gruppo; deterministici, popolazione dichiarata.
  Non sono scelte linguistiche o audit umano gia' effettuato.
- `manifesto.json`: schemi distinti, politica/parser, input e artefatti
  con hash, provenienza e limiti di licenza.

Non viene duplicata anche la vecchia coda combinata `revisione.jsonl`.
Code disgiunte per risultato finale; CONFERMA/AMBIGUO ufficiali non riappaiono
solo perche' l'automatico era problematico. DA_RIVEDERE ufficiale resta
prioritario; ESCLUDI ufficiale resta pendente senza effetti sul dataset.
Ogni record di coda contiene testimoni sintetici sufficienti alla visualizzazione
offline: sillabazione, IPA per conteggio, analisi PhonItalia per conteggio e
riferimenti 1-based ai raw. Non copia tutto il testo originale.

Il confronto e' CONCORDANZA INTERNA, non accuratezza: non esiste un gold
completo. Campioni e nuove promozioni vanno sottoposti ad audit stratificato,
senza trasformare tutte le vecchie 11.414 candidate sperimentali in RISOLTO.

## Revisore mobile/offline e merge: stato attuale

Il [revisore mobile/offline](../revisore_sillabe/README.md) e' implementato in
`tools/revisore_sillabe/`: salva la sessione in IndexedDB, importa pacchetti
e consente l'export delle proposte di curatela. La preparazione dei pacchetti
e' implementata da `tools/prepara_revisione_mobile.py`; richiede manifesto
schema 2 e code coerenti prodotti da questa pipeline, sempre esterni.

`tools/unisci_proposte_curatela.py` implementa l'analisi/merge conservativo
sul PC: controlla base Git, decisione_base, storico e conflitti. Produce un
rapporto e, solo se richiesta, una curatela candidata esterna al repository.
Non applica automaticamente la candidata alla curatela versionata.
Approvazione definitiva, sostituzione della curatela ufficiale e operazioni
git add/commit/push restano esplicite; non c'e' sincronizzazione GitHub automatica.

### Progettazione storica del revisore e dello scambio

La sezione seguente conserva la progettazione precedente all'implementazione.
Le formulazioni al futuro e le funzionalita' dichiarate assenti descrivono
quella fase storica, NON lo stato attuale riepilogato sopra.

Il record e' autocontenuto per una parola. Futuri pacchetti di coda/campioni
in piccoli blocchi, con manifesto e hash, potranno essere caricati prima
della sessione: il telefono non deve scaricare/tenere in RAM l'intero raw.
La parola e' la chiave stabile, l'indice e' solo posizione nella versione
corrente. Il futuro indice di ricerca/filtro e la persistenza del cursore
vanno progettati separatamente; nulla di cio' e' implementato.

Azioni ufficiali: conferma singola, vera ambiguita', rinvio, esclusione.
Salta/precedente/cursore sono stato della sessione, NON curatela.
Il futuro revisore dovra' salvare localmente dopo ogni scelta, conservare
le evidenze/automatico e riprendere offline; le decisioni viaggeranno senza
centinaia di MB di annotazioni. Nessuna UI, PWA, IndexedDB, sincronizzazione
GitHub, import/export o merge implementati ora.

#### Proposta storica di scambio delle sole decisioni

```json
{
  "schema_version": 1,
  "tipo": "proposte_curatela_ufficiale",
  "sessione_id": "identificatore-univoco",
  "base": {
    "vocabolario_sha256": "HASH_VOCABOLARIO",
    "grafie": 558124,
    "curatela_schema_version": 1,
    "curatela_sha256": "HASH_CURATELA_BASE",
    "curatela_revisione_git_base": "COMMIT_BASE_VERIFICABILE",
    "annotazioni_schema_version": 2,
    "politica_version": "offline-v2-evidenze",
    "manifesto_sha256": "HASH_MANIFESTO_ANNOTAZIONI"
  },
  "decisioni": [
    {
      "parola": "grafia-di-esempio",
      "azione": "CONFERMA",
      "conteggi": [3],
      "autore": "Autore del progetto",
      "data": "2026-10-02T10:00:00+02:00",
      "motivazione": "Motivazione esplicita",
      "decisione_base": null
    }
  ]
}
```

`decisione_base` contiene l'intera precedente decisione ufficiale per quella
parola, oppure null se assente; insieme all'hash della curatela identifica
il pre-requisito dell'aggiornamento. Per rilevare anche modifiche poi annullate
(ABA), il manifesto di sessione dovra' conservare il commit/revisione della
curatela di partenza e il merge dovra' consultare lo storico per parola;
il semplice confronto del valore corrente non rileva ABA.
Un eventuale futuro identificatore di revisione per decisione migliorera'
questa verifica: non cambia ora lo schema 1.

Proposta di merge sicuro futuro, NON implementato:
1. Validare formato, autore, grafia, azione, conteggi, hash/revisione di base;
   non importare dati automatici come decisioni ufficiali.
2. Se il vocabolario e' cambiato, riallineare per parola e sottoporre le grafie
   assenti/cambiate a controllo; non riutilizzare indici vecchi.
3. Se la curatela globale e' cambiata, non rifiutare necessariamente decisioni
   su altre parole: verificare per parola valore base e storico dalla revisione.
4. Applicare solo se quella parola non e' stata modificata nel frattempo;
   decisione gia' uguale = importazione idempotente. Una modifica intervenuta,
   anche con ritorno al vecchio valore, richiede segnalazione esplicita.
5. Se manca lo storico/revisione sufficiente, NON sovrascrivere: chiedere
   conferma. Conflitto da mostrare con base, attuale e proposta, non
   "ultima data vince". Data del telefono e autore dichiarato non autenticano
   automaticamente una decisione.
6. Solo approvazione esplicita dell'autore aggiorna la curatela versionabile.
   Lo scambio e' una PROPOSTA: non aggira la priorita' ufficiale o l'audit.
7. Le future modifiche definitive verranno versionate dall'autore; questa
   pipeline non fa git add/commit/push e non attua alcun merge.

## Runtime: stato attuale

Il [runtime ufficiale BITMAP-V1](RUNTIME_SILLABE.md) e' implementato e integrato
nel core C++, nei binding WASM e nella web app, compresi filtro sillabico,
cache PWA/offline e profilo personale ibrido. Conserva conteggi finali, stato,
origine e R1, con identita' SHA-256 dello snapshot del vocabolario.
Le decisioni ufficiali sono applicate dalla pipeline prima della generazione;
il browser non ripete la curatela. Restano distinti i futuri override personali
e l'eventuale eliminazione esplicita delle grafie dal dataset, non implementati.
