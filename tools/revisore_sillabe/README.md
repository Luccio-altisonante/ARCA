# Revisore manuale delle sillabe

App statica separata dall'applicazione principale, mobile-first e utilizzabile
offline dopo il caricamento iniziale. Nessun framework, CDN, font remoto,
analytics, login, invio di dati o accesso a GitHub. Le uniche richieste di rete
sono quelle per l'app shell dal suo stesso origin, compresi gli aggiornamenti.
Le revisioni non richiedono un server attivo dopo che la shell e' in cache.

**Le decisioni sono proposte di curatela ufficiale, non override personali.**
Non modificano il vocabolario, il core, la pipeline, il runtime o
`curatela_ufficiale.json`. Il controllo/merge conservativo sul PC e' implementato
da `tools/unisci_proposte_curatela.py`: verifica base Git, decisione_base,
storico e conflitti; puo' produrre, se richiesta, una candidata esterna al
repository. Non applica automaticamente la candidata: approvazione finale e
sostituzione della curatela ufficiale rimangono esplicite, senza sincronizzazione
GitHub automatica.

## Generare e trasferire il pacchetto

`prepara_revisione_mobile.py` richiede un manifesto schema 2 prodotto dalla
[pipeline di annotazione](../sillabe/README.md), dove sono descritte generazione
e provenienza degli input. Il manifesto e le code JSONL associate sono
artefatti esterni e NON sono distribuiti nel repository. Devono appartenere
alla stessa esecuzione verificata e il manifesto deve essere coerente con la
curatela attuale, secondo i controlli della CLI. Il solo clone non basta per
generare un pacchetto reale senza questi input esterni.

Dalla radice del repository, con Python 3.10+ (sola libreria standard),
sostituire il seguente percorso generico con il proprio manifesto verificato
e scegliere un output esterno non ancora esistente:

```powershell
$manifesto = "C:\percorso\output-annotazioni\manifesto.json"

python -B ./tools/prepara_revisione_mobile.py `
  --manifesto $manifesto `
  --output "$env:TEMP/pacchetto_revisione_sillabe.json"
```

La CLI legge la curatela del repository, verifica l'hash nel manifesto,
l'hash/dimensione della coda e la copia della curatela in HEAD. Il commit di
base e' quello verificato, non un valore dichiarato dall'utente. Il generatore
non modifica gli input, non scarica dati e rifiuta output dentro il repository
o file gia' esistenti. Un file diverso dal manifesto/coda attesi non viene
considerato un semplice pacchetto equivalente.

Parametri: `--coda revisione_prioritaria` (default), `stime_corroborate`,
`stime_non_verificate`; `--offset N --limite N` per sottoinsiemi nell'ordine
originale della coda. Non viene introdotto un nuovo ordinamento linguistico.
Il limite e' 100000 record e 64 MiB: le code troppo grandi richiedono blocchi
espliciti. Anche selezionando un blocco si controlla l'intera coda.
`--curatela` puo' specificare un file, ma deve corrispondere al manifesto.
`--senza-git` consente fixture/archivi senza storico: base Git null, NON una
prova di concorrenza; l'analisi sul PC richiede un controllo esplicito.

Trasferire manualmente il JSON sul telefono, per esempio tramite cavo o un
mezzo scelto dall'autore. Nell'app: **Importa pacchetto**, selezionare il file,
configurare l'autore in **Sessione e backup**. Il pacchetto non viene caricato
su server, incluso in cache SW, aggiunto a Git o pubblicato.

## Avvio e PWA

```powershell
cd tools/revisore_sillabe
python -m http.server 8765 --bind 127.0.0.1
```

Aprire <http://localhost:8765/>. Il server serve SOLO questa directory, non
il repository o i dati. Nessuna build. Per sviluppo locale e' sufficiente
localhost. Per usare/installare dal telefono serve un origin HTTPS:
un normale IP LAN in HTTP non abilita i Service Worker. Non e' stato fatto
alcun deploy con questi comandi. Preparazione HTTPS/mobile: [MOBILE.md](MOBILE.md).
L'installazione dipende dal browser: usare il suo comando
Installa/Aggiungi alla schermata Home; dove disponibile appare anche Installa app.

Manifest con scope relativo e icone PNG locali 192/512 px. SW cache-first,
solo URL espliciti dell'app shell. Nessun dato del pacchetto in Cache Storage.
Cache con prefisso esclusivo del revisore; non cancella cache di altre app.
Un aggiornamento attende: **Aggiorna app** lo attiva dopo i salvataggi,
non sostituisce silenziosamente la UI durante una decisione.
Al cambiare la shell, incrementare la versione della cache nel SW.

Attendere **App pronta offline**, importare il pacchetto e completare una
prova di ricaricamento. A quel punto la revisione e l'export funzionano senza
rete. L'app non usa fetch per le evidenze: i file scelti vengono letti localmente.

Riferimenti: [Service Worker e secure context](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API),
[Installabilita' PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

## Formati

Pacchetto schema **1**, tipo `pacchetto_revisione_sillabe`:

```text
schema_version, tipo, creato_utc, coda
base:
  vocabolario_sha256, grafie
  curatela_schema_version=1, curatela_sha256, curatela_revisione_git_base
  annotazioni_schema_version=2, politica_version=offline-v2-evidenze
  manifesto_sha256
intervallo: offset, record_coda
note_licenza
record[]:
  parola, indice, r1, stato_automatico, motivo, candidati
  macro_famiglie: wiktionary, phonitalia
  evidenze: wiktionary, wiktionary_ipa, wikipron, phonitalia
    conteggi, anomalie, testimoni, esempi_anomalie
  decisione_base (ufficiale, oppure null), priorita
```

Solo campi ammessi, testimoni sintetici; nessun raw, elenco di righe completo
o statistica globale ripetuta. La UI distingue dato automatico/tua decisione.
Conteggi vuoti significano assenza di una scelta, non zero sillabe.

IndexedDB: database **anagrammi-revisore-sillabe**, versione **1**:

| Store | Chiave | Contenuto |
| --- | --- | --- |
| packages | id = SHA-256 del file importato | Metadata/base, senza record duplicati |
| records | parola | Record della sessione corrente |
| decisions | parola | Proposta manuale corrente |
| session | current | packageId, UUID, revisione, cursore per parola, filtri, saltate, note, autore |

Una sola sessione corrente: prima di sostituirla la UI richiede conferma.
Reimportare lo stesso file/hash mantiene la sessione. Un pacchetto diverso
non viene fuso automaticamente col precedente: esportare prima le decisioni.
Il database non usa l'indice come identita', ne' localStorage per i dati.

Export schema **1**, tipo `proposte_curatela_ufficiale`:

```text
schema_version, tipo, sessione_id, base
decisioni[]:
  parola, azione, conteggi, autore, data, motivazione, decisione_base
```

La base viene copiata integralmente dal pacchetto. L'export contiene SOLO
decisioni manuali, ordinate secondo l'ordine del pacchetto, non saltate,
evidenze, raw, cursore o statistiche. Non e' una firma/autenticazione:
autore, UUID e orologio del dispositivo non provano l'identita'.

## Decisioni, navigazione e salvataggio

- CONFERMA: un intero positivo; rapidi 1..4 e candidati, piu' Altro numero.
- AMBIGUO: almeno due interi positivi distinti, checkbox e numeri aggiuntivi;
  ordinamento numerico deterministico nell'export.
- DA_RIVEDERE: lista vuota, proposta ufficiale di rinvio.
- ESCLUDI: lista vuota, conferma aggiuntiva contro tocchi accidentali;
  non modifica il vocabolario.
- SALTA: soltanto stato locale, non DA_RIVEDERE e non una decisione esportata.
  Per saltare una parola gia' decisa, prima revocare la decisione.
- Precedente/successiva rispettano il filtro corrente. Default Tutte permette
  di tornare immediatamente all'ultima parola decisa. Prima non decisa azzera
  ricerca/stato e seleziona il filtro Non decise. Quest'ultimo include le saltate.
- Ricerca per sottostringa (anche grafia esatta), NFC/minuscolo senza rimuovere
  accenti; filtri per stato automatico e tutte/non decise/decise/saltate.
- Per modificare: tornare alla parola e scegliere una nuova azione/conteggio.
  Revoca la lascia senza proposta; l'evidenza automatica e' immutata.
- Posizione nel pacchetto e nel filtro; decise/saltate/da fare sono disgiunte.
  Da fare = totale - decise - saltate. Il filtro Non decise conserva le saltate.

Ogni decisione/modifica/revoca viene salvata **immediatamente** con il cursore
e stato locale nella stessa transazione IndexedDB. Avanzamento solo dopo
`transaction.oncomplete`; se fallisce non si mostra la scelta come salvata.
Le azioni vengono serializzate e disabilitate durante il salvataggio. Anche
autore, note, filtri e navigazione vengono persistiti senza un pulsante Salva.
Per le note su una decisione gia' data viene aggiornata anche la motivazione
e la data della proposta. Le note senza decisione restano bozze locali.

Motivazione vuota: `Revisione manuale tramite revisore sillabico`.
Nota non vuota, ripulita dagli spazi esterni: usata integralmente come
motivazione. Autore configurato una volta e conservato; modificarlo non
riscrive tutte le vecchie decisioni.

Non implementate scorciatoie numeriche: evita conferme involontarie mentre
si compilano note. Navigazione da tastiera standard, focus visibile, label,
dialog semantico, touch target 48 px, zoom non disabilitato, nessuna animazione.

## Backup e ripristino

**Esporta decisioni** scarica sempre il JSON. Dove `canShare({files})` e'
disponibile e' offerta Condividi; il download non dipende dalla condivisione.
Fare backup periodici e prima di cambiare pacchetto/browser/dispositivo.

Per ripristinare su un altro dispositivo: importare lo stesso pacchetto,
poi **Ripristina decisioni** nel menu Sessione e backup. Tutti gli hash,
versioni, commit/base, parole e decisione_base devono coincidere. Un backup
da un altro blocco contenente parole non presenti e' rifiutato interamente.
Prima si valida tutto, poi si esegue una transazione: nessun import parziale.
Proposte nuove/idempotenti accettate; decisioni locali differenti richiedono
conferma esplicita (numero e parole mostrate). Annulla conserva tutto.
Non sono cancellate decisioni locali assenti dal backup. L'UUID della sessione
locale resta distinto da quello del backup importato.

Il file export NON ripristina cursore/filtri/saltate o bozze senza decisione:
trasporta intenzionalmente solo la curatela proposta. Tali informazioni sono
invece ripristinate dalla sessione IndexedDB dopo un normale refresh.

## Schede concorrenti, sicurezza e limiti

BroadcastChannel annuncia altre schede e notifica i salvataggi. Inoltre OGNI
scrittura confronta packageId e revisione della sessione nella transazione
IndexedDB: una scheda obsoleta non puo' sovrascrivere anche senza BroadcastChannel.
La UI segnala e ricarica il dato corrente; si ripete la scelta esplicitamente.
Questo e' controllo locale, non merge con la curatela sul PC.

File UTF-8 massimo 64 MiB; schema/campi, hash presenti, grafie canoniche,
duplicati, indici, evidenze, azioni, conteggi e base validati prima di importare.
Testi resi soltanto con textContent, niente HTML dei file; CSP senza CDN/script
inline. Hash di base non dimostrano che un file sia autentico: importare solo
pacchetti/proposte di provenienza nota. Il sito stesso deve essere fidato.
Le azioni sono limitate a interi 1..1000000, non a un byte o ai suggerimenti.

IndexedDB rimane soggetto a quota, cancellazione manuale, profilo privato,
eviction o malfunzionamenti del dispositivo. Mantieni dati sul dispositivo
richiede `navigator.storage.persist()` ma il browser puo' negarlo. Non promette
durata infinita: il backup esportato e' indispensabile. Se chiudi durante una
transazione non ancora conclusa, non e' garantito l'ultimo tocco non confermato.

Il revisore carica il pacchetto (massimo 100000 record) in memoria;
preferire blocchi piu' piccoli su dispositivi con poca RAM. Non carica mai i
613 MB di annotazioni globali e non carica il runtime sillabico dell'app ARCA.
Non sono ancora verificati tutti i comportamenti di Safari/iOS e installazione
sui telefoni fisici: serve una prova con HTTPS sul dispositivo prima dell'uso
prolungato. Browser diversi/origin diversi hanno archivi locali diversi.

## Licenze

La PWA vuota contiene solo codice e icone locali del progetto, nessun lessico.
Il pacchetto e' un artefatto LOCALE: piccoli testimoni da Wiktionary/Wiktextract,
WikiPron e PhonItalia. Dati WikiPron NON Apache 2 del software; PhonItalia
indicato CC BY4.0 con attribuzione Goslin/Galuzzi/Romani e Coretta per il package.
Una redistribuzione pubblica dei pacchetti richiede verifica separata di
attribuzioni/condizioni/share-alike. Non cambia la licenza generale del progetto.

## Test

Dalla radice:

```powershell
python -B -m unittest discover -s tools/tests -p test_prepara_revisione_mobile.py -v
node --test tools/tests/reviewer-core.test.mjs
```

Non sono necessarie dipendenze Node. La pipeline v2 esistente ha una suite
separata, lasciata invariata. I test pure-JS non simulano IndexedDB o SW:
il collaudo browser deve coprire transazioni, refresh, app shell offline,
export, import incompatibile, conflitti locali e multi-tab.

Per i test sul database REALE del browser, ma isolato dalla sessione:
servire la cartella `tools` su una porta separata e aprire
`/tests/reviewer-db-browser.html`. Il database ha un nome UUID dedicato,
contiene solo fixture sintetiche e viene cancellato alla fine. Verifica anche
la protezione atomica contro una seconda connessione/revisione obsoleta.

Procedura browser ripetibile: importa pacchetto, configura Autore, decidi
e salta parole, verifica conteggi/export, ricarica, modifica/revoca, prova
ambiguita' ed esclusione con conferma, ripristina un backup compatibile e
rifiuta quello incompatibile. Dopo App pronta offline attiva Offline negli
strumenti browser, ricarica e verifica lettura/decisioni/export. Apri una
seconda scheda e controlla il messaggio e la protezione delle scritture obsolete.

I risultati della prima verifica e il pacchetto reale sono descritti in
`VERIFICA.md`. Nessun pacchetto di evidenze e' incluso in questa directory.
