# Merge conservativo delle proposte

`tools/unisci_proposte_curatela.py` analizza **un solo export cumulativo** di
tipo `proposte_curatela_ufficiale`, scelto consapevolmente dall'autore. Non
deduce quale backup sia piu' recente e non fonde automaticamente sessioni.
Non legge backup implicitamente: gli input sono tutti espliciti.

Non modifica il revisore, i pacchetti, il core, il vocabolario, il sito o
IndexedDB. Non implementa apply-in-place, override personali, esclusioni dal
dataset o commit. La curatela ufficiale e' autoritativa: nessuna data del
telefono decide un conflitto.

## Validazione e classificazione

Si riutilizzano senza modificarli il validatore `carica_curatela()` della
pipeline e i controlli di grafia/conteggi/testo del preparatore mobile.
Un adattatore in memoria passa gli snapshot al validatore della curatela:
nessuna curatela temporanea viene scritta per validare una decisione.
Gli schemi esistenti non cambiano. Campi sconosciuti, chiavi JSON duplicate,
versioni incompatibili e parole ripetute non vengono ignorati. Conteggi
booleani, non positivi, non ordinati o ripetuti non sono accettati.

Le categorie del rapporto sono:

- `APPLICABILE`: base della parola uguale alla corrente, base Git autentica,
  storico verificato senza modifiche a quella parola e vocabolario verificato.
- `IDEMPOTENTE`: proposta gia' esattamente presente, inclusi i metadati;
  nessuna scrittura di quella decisione. Richiede base della parola uguale alla
  corrente e storico verificato senza modifiche successive alla parola.
- `CONFLITTO`: decisione corrente diversa dalla base della parola; resta intatta.
- `BASE_INCOMPATIBILE`: schema/politica/hash/base Git non compatibili o
  `decisione_base` non corrispondente al commit dichiarato.
- `PAROLA_NON_VALIDA`: grafia non canonica o assente dal vocabolario verificato.
- `RICHIEDE_CONTROLLO`: decisione malformata o vocabolario non verificato.
- `RICHIEDE_CONTROLLO_STORICO`: cambiamenti Git alla parola dopo la base,
  anche ABA, oppure storico non verificabile. Mai applicazione automatica.

La decisione corrente deve coincidere con **tutto** `decisione_base`, non
soltanto con il conteggio. `null` significa assenza: se compare una decisione
corrente, e' un conflitto anche se la proposta coincide con essa. Anche una correzione
intenzionale sopra una base uguale e' applicabile solo dopo tutti i controlli.
Un conflitto corrente e' indicato come tale anche se lo storico contiene
modifiche: queste rimangono visibili nella sezione Git del rapporto. Una
proposta identica alla corrente con base uguale ma con modifiche Git successive
alla base, o storico non verificabile, resta invariata ed e' segnalata per
controllo storico, non classificata idempotente. Se invece la base differisce
dalla corrente, prevale sempre il conflitto.

## Git e ABA

Il tool verifica che la revisione sia un commit esistente e antenato della HEAD,
poi legge con `git show` `tools/sillabe/curatela_ufficiale.json` a quella
revisione. Lo SHA-256 e' calcolato sui byte Git, non su JSON riserializzato.
Verifica anche la base di ogni parola contro quel contenuto.

Per rilevare A -> B -> A confronta le decisioni su tutti gli archi dei commit
in `base..HEAD`, compresi tutti i genitori dei merge. Non usa un log limitato
al percorso, che potrebbe semplificare la storia. Un cambiamento di azione,
conteggi o metadati della parola richiede controllo storico. Modifiche ad altre
parole non bloccano la proposta. Le modifiche nella copia corrente rispetto
alla base sono inoltre rilevate dal confronto a tre vie.

Base Git nulla, repository shallow, replace/grafts, oggetti mancanti, snapshot
non validabili o timeout non equivalgono a "nessun conflitto". Le nuove
decisioni restano bloccate. Senza Git, se anche l'hash corrente differisce dalla
base, la base viene classificata incompatibile. Lo storico non e' verificabile
per modifiche non committate poi annullate o per storia riscritta/priva degli
oggetti originali: non esiste un registro indipendente di tali eventi.

Il vocabolario esplicito deve corrispondere a SHA-256 e numero di grafie della
base, essere canonico e non avere duplicati. Senza questo input le nuove
proposte non sono applicabili. Il manifesto originale e' opzionale: se fornito
si verifica il digest; altrimenti il rapporto dichiara che non e' verificato.
Non sono verificati evidenze raw, pacchetto originale o autenticita' dell'autore.

## Uso futuro (non usare ancora sui backup reali)

I seguenti nomi sono esempi per una futura campagna conclusa, non un invito ad
aprire le decisioni in lavorazione. Usare per ora esclusivamente fixture sintetiche.
La directory di output deve esistere, essere fuori dal repository e i nomi
devono essere nuovi. Il tool non sovrascrive neppure un precedente rapporto.

Dry-run predefinito (scrive soltanto il rapporto esterno):

```text
python -B tools/unisci_proposte_curatela.py --proposte C:/campagna/export.json --curatela C:/campagna/curatela_corrente.json --vocabolario C:/campagna/vocabolario.txt --report C:/campagna/rapporto.json
```

Per generare esplicitamente anche una candidata aggiungere:

```text
--candidata C:/campagna/curatela_candidata.json
```

`--manifesto` permette di verificare il manifesto originale. `--repository`
seleziona il repository Git da leggere (normalmente quello del progetto).
Non esiste alcuna opzione che forzi l'applicazione di un conflitto.

Exit code: `0` tutte le decisioni applicabili/idempotenti e nessun problema
di base; `1` rapporto prodotto ma ci sono decisioni bloccate/problemi di base;
`2` input strutturalmente invalido, output non sicuro o errore di esecuzione.
Una candidata puo' essere prodotta anche con exit code `1`: contiene solo le
proposte applicabili, oltre a tutta la curatela corrente.

## Artefatti e flusso

Il report JSON schema 1 contiene hash degli input, sessione, base dichiarata,
numero decisioni, conteggi per categoria, problemi di base/storico, HEAD,
commit coinvolti, dettaglio per parola (proposta/base/corrente/motivo), verifiche
effettuate e SHA-256 della candidata oppure `null`. Nessun dataset raw viene
incluso. Gli errori strutturali interrompono prima di scrivere gli output.

La candidata mantiene esattamente lo schema della curatela ufficiale:

```json
{"schema_version": 1, "tipo": "curatela_ufficiale", "decisioni": {}}
```

Le decisioni sono indicizzate per parola. Le correnti restano tutte presenti;
si aggiungono/sostituiscono **solo** le applicabili. `ESCLUDI` resta una decisione,
non rimuove nulla dal vocabolario. JSON UTF-8 con chiavi ordinate e newline:
a parita' di input e stato Git output byte-per-byte deterministici, senza data
di esecuzione. Se cambiano i byte dell'export, cambia giustamente il suo hash.
Gli input e HEAD vengono ricontrollati prima di restituire l'analisi.
I file esterni sono creati in modo esclusivo; un errore di scrittura ripulisce
solo i nuovi output della chiamata. Non e' una transazione atomica di due file
resistente a spegnimento improvviso; non eseguire contro input modificati
contemporaneamente. Su filesystem ostili le normali garanzie dei percorsi
Python non sostituiscono la sicurezza della directory di output.

Flusso futuro: export scelto -> dry-run -> verifica rapporto -> candidata
esterna -> revisione umana -> solo successivamente copia/commit espliciti.
Il tool non compie gli ultimi due passi. Le esclusioni dal dataset richiederanno
una rigenerazione futura separata e controllata.

## Test sintetici

```text
python -B -m unittest discover -s tools/tests -p test_unisci_proposte_curatela.py -v
```

I test creano solo fixture e repository Git temporanei fuori dal progetto;
lo storico viene costruito con Git plumbing, senza `git add` o `git commit`.
Non leggono la curatela reale o `dati_locali/` e non toccano il revisore.
