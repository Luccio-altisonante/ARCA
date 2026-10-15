# Seconda esecuzione: pipeline offline v2

Data: 2026-10-02. Repository: ARCA.
Branch iniziale/finale: `main`; HEAD iniziale/finale:
`295bb80ea35f204535d1c103b6364fba6405cc92`.
Working tree inizialmente pulita. Nessun add, commit, push o deploy.

Questo rapporto registra un'annotazione AUTOMATICA, non una nuova curatela
linguistica. Non esiste un gold completo: concordanza e copertura non sono
accuratezza. La curatela ufficiale rimane vuota, schema 1, byte-per-byte invariata.

## Politica e confidenza

- Politica `offline-v2-evidenze`; parser `ipa-v2-conservativo-2`.
- Schemi distinti: curatela 1, annotazioni 2, manifesto 2.
- Wiktionary hyphenation, IPA locale e WikiPron sono TRE SEGNALI di UNA famiglia.
- PhonItalia e' la seconda famiglia lessicale indipendente. R1 e' un'euristica,
  non una terza fonte lessicale e non un voto di maggioranza.
- `RISOLTO`: due famiglie univoche concordanti, senza anomalie rilevanti.
- `STIMA_CORROBORATA`: una famiglia univoca concordante con R1, senza contrasti.
- `SOLO_STIMA`: R1 positivo senza evidenza lessicale utile.
- `CONFLITTO`: incompatibilita', nessun vincitore e conteggio finale vuoto.
- `AMBIGUO`: le stesse alternative corroborate nelle due famiglie, almeno un
  segnale Wiktionary che attesta l'intero insieme e analisi PhonItalia distinte.
- `DA_RIVEDERE`: anomalie/incompletezza, alternative deboli o singola famiglia
  contraria a R1; candidati conservati separatamente, conteggio finale vuoto.
- Ogni decisione manuale prevale sempre; le evidenze automatiche restano visibili.
  `ESCLUDI` e' pendente: non rimuove grafie dal dataset.

Eccezione di confidenza generale e documentata, NON eccezioni per parola:
l'avvertenza IPA `vocali_adiacenti_non_disambiguate` non distrugge un consenso
hyphenation/PhonItalia gia' pulito e identico se i candidati IPA sono un suo
sottoinsieme. L'avvertenza resta nel record. Non vale per simboli sconosciuti,
trascrizioni malformate o nuove alternative esterne al consenso. Il solo IPA
incerto NON ottiene questo trattamento per promuovere una stima.

I segnali di una famiglia vengono conservati separati. I loro candidati non
vengono ristretti arbitrariamente: l'unione e' visibile. Analisi disgiunte sono
un conflitto; un sottoinsieme puo' sostenere un'alternativa, non negare le altre.
Un conflitto preesistente fra hyphenation e PhonItalia non viene cancellato
quando nuovi segnali allargano l'unione fino a farla coincidere con PhonItalia.

## Provenienza e hash degli input

Tutti gli input erano disponibili localmente: nessun nuovo download.
WikiPron broad italiano, commit `960eba421beae7ded634f545b98922fa03e6b19f`:
<https://raw.githubusercontent.com/CUNY-CL/wikipron/960eba421beae7ded634f545b98922fa03e6b19f/data/scrape/tsv/ita_latn_broad.tsv>.
Il TSV con hash diverso viene rifiutato.
Raw Wiktextract del 2026-09-01, via <https://kaikki.org/dictionary/Italian/>.
PhonItalia 1.10, package phonItaliaR 1.0.0:
<https://stefanocoretta.github.io/phonItaliaR/>.
La baseline v1 e' quella della prima esecuzione; confronto su grafia e indice,
con rifiuto di baseline piu' corta, piu' lunga o non allineata.

| Input | Byte | SHA-256 |
| --- | --- | --- |
| vocabolario | 6585461 | `b3b5703f69874095e9f9ac630ed0a608b919d969d5cd3a6b6477735db8595ad6` |
| wiktionary | 43612281 | `ca3bb0aa07d5730d7a0c7fb106da8e3c9079d598a5914744c803a0f876a429dc` |
| phonitalia | 46276243 | `22d22409c1fc3ad2844f47543f3017c50ef9d3f95f5196093ff2203d7f071b17` |
| curatela | 77 | `7212b40c3a1308f79e220926247a9c6274e30d2e20c99ac8799844d447a71241` |
| runner | 503019 | `0f866a8e5c5c2ed56ea8d0bb5cd4c3fc7447b883ffd6e96a30b9dd01b8351604` |
| runner_build | 1065 | `241cac1931ea13df6a433f93b7c09858b27b5d7f54e9109461e7a0e19478b7bb` |
| pipeline | 34400 | `bc44c347c91fffd9cd2355e5e7b77716d4fbc67d8947f12a5067146c716de68f` |
| parser_ipa | 5285 | `31c8c9890e8691895bf444841823395f4477e41501a593d2509197f0276599dd` |
| audit | 6371 | `1db2e9012658cd7d336fb07d0638c7e61b133cbdefb34ccac60ee26d438810c2` |
| wikipron | 2618651 | `b81cc2c901b685de08f1a4428de36f39cd7b0d59fee15f7c6000f1e61a1f75a2` |
| annotazioni_precedenti | 287156447 | `3cc0a635aed3d525a23bab5525e9bd7697caa9343c3d85e336187da1e999c770` |

Percorsi esatti, provenienza, versioni e licenze sono conservati nel manifesto esterno.

Hash dei sorgenti del runner C++17 (tutti invariati):

| Sorgente | SHA-256 |
| --- | --- |
| core/sillabe.cpp | `733c4df0ea7204469d47bdf47a4c662bd04582432c160d24f9a4c7058f910a90` |
| core/sillabe.hpp | `0d19322e2b42e800e71c79b3a0501c707dfea38dd5c727603c3c8ca6a4a6cf4b` |
| core/unicode.cpp | `2e21d07179945894e046db9ef28b620e243d0cc36c8cdbb10ac0f96f1e8ea582` |
| core/unicode.hpp | `3f07820ed85fc80878d5536c5c6dc21bdcfd4caa8bd258bb1184c7f13d4f1d7b` |
| third_party/utf8proc/utf8proc.c | `f38438eb986ba7eedad0f2e820a70fae1aaf05197364ba0381a5e84775099ef8` |
| third_party/utf8proc/utf8proc.h | `08da85e820efaa3613500946c26b2dc427a07f76001ed7c16bc90f298b814c35` |
| third_party/utf8proc/utf8proc_data.c | `b4911d4162d216afa612317a9b981851e15d672f4d93b25f3a1eb986f8c0aedb` |
| tools/conta_sillabe_batch.cpp | `1370b75d1512addd90fb90417dca9da3a7ab750abf894f18fa1c6f4dec42d709` |

## Distribuzione degli stati

| Stato | v1 | v2 |
| --- | --- | --- |
| RISOLTO | 104332 | 43252 |
| STIMA_CORROBORATA | 0 | 67730 |
| AMBIGUO | 2 | 2 |
| CONFLITTO | 1042 | 2649 |
| SOLO_STIMA | 445697 | 433438 |
| DA_RIVEDERE | 7051 | 11053 |
| ESCLUDI | 0 | 0 |

Totale invariato: **558124**. Tutti i record hanno origine `automatico`; nessuna decisione manuale aggiunta.

| Transizione | Grafie |
| --- | --- |
| AMBIGUO -> AMBIGUO | 2 |
| CONFLITTO -> CONFLITTO | 1042 |
| DA_RIVEDERE -> CONFLITTO | 433 |
| DA_RIVEDERE -> DA_RIVEDERE | 6614 |
| DA_RIVEDERE -> RISOLTO | 4 |
| RISOLTO -> CONFLITTO | 1170 |
| RISOLTO -> DA_RIVEDERE | 3550 |
| RISOLTO -> RISOLTO | 43248 |
| RISOLTO -> STIMA_CORROBORATA | 56364 |
| SOLO_STIMA -> CONFLITTO | 4 |
| SOLO_STIMA -> DA_RIVEDERE | 889 |
| SOLO_STIMA -> SOLO_STIMA | 433438 |
| SOLO_STIMA -> STIMA_CORROBORATA | 11366 |

Cambi di stato: **73780**. Cambi del conteggio R1: **0**.
56364 vecchi RISOLTO diventano STIMA_CORROBORATA: riclassificazione intenzionale
di confidenza, non cambiamento del loro numero di sillabe.
Altri 1170 vecchi RISOLTO diventano CONFLITTO e 3550 DA_RIVEDERE per segnali
aggiuntivi/controlli conservativi: vanno distinti da una correzione linguistica.

Fra i 445697 vecchi SOLO_STIMA:

- 12259 hanno un nuovo record IPA/WikiPron, anche incompleto;
- 12216 hanno almeno un nuovo conteggio candidato;
- 11383 soddisfano la concordanza numerica delle nuove evidenze con R1 prima
  del controllo delle anomalie;
- 11366 diventano STIMA_CORROBORATA; 17 candidate sono fermate dalle anomalie;
- 0 diventano RISOLTO; 433438 restano SOLO_STIMA;
- 889 diventano DA_RIVEDERE e 4 CONFLITTO.

Le 11414 candidate dell'esperimento precedente NON sono state promosse in blocco.
I numeri differiscono per la politica e il parser esplicitamente conservativi.
La selezione non usa liste di parole/eccezioni hard-coded.

## Copertura e sovrapposizioni

Copertura significa presenza di almeno un candidato, non assenza di anomalie
ne' prova di correttezza. I candidati incerti restano riconoscibili nei record.

| Segnale o unione | Grafie con candidato |
| --- | --- |
| wiktionary | 83087 |
| phonitalia | 69575 |
| entrambe | 41260 |
| almeno_una | 111402 |
| wiktionary_ipa | 38454 |
| wikipron | 53220 |
| almeno_un_segnale_v2 | 123976 |
| famiglia_wiktionary | 101250 |
| nuove_ipa_entrambe | 23104 |
| nuove_ipa_almeno_una | 68570 |

WikiPron: 89608 righe, 59691 associate; 53231 grafie associate, 53220 con
candidato, 3054 con almeno un'anomalia.
IPA locale: 54783 trascrizioni associate, 42219 grafie con IPA, 38454 con
candidato, 5469 con almeno un'anomalia. Solo voci italiane/grafia esatta
normalizzata NFC-minuscolo; nessun trasferimento dal lemma alle flessioni.

La copertura con candidato e' piu' bassa dei circa 53229/42050 dell'esperimento:
non si scartano grafie dal vocabolario, si rifiuta di certificare trascrizioni
editoriali o non interpretabili. Restano riferimenti e testimoni di anomalie.
IPA locale e WikiPron insieme coprono 68570 grafie con candidato, con
23104 in comune; non sono due famiglie indipendenti.

| Numero famiglie lessicali con candidato | Grafie |
| --- | --- |
| 0 | 434148 |
| 1 | 77127 |
| 2 | 46849 |

Sovrapposizioni esclusive dei quattro segnali (ogni grafia compare una volta):

| Segnali presenti | Grafie |
| --- | --- |
| nessuno | 434148 |
| phonitalia | 22726 |
| wikipron | 11973 |
| wikipron+phonitalia | 5381 |
| wiktionary | 21532 |
| wiktionary+phonitalia | 11148 |
| wiktionary+wikipron | 5088 |
| wiktionary+wikipron+phonitalia | 7674 |
| wiktionary+wiktionary_ipa | 9537 |
| wiktionary+wiktionary_ipa+phonitalia | 5257 |
| wiktionary+wiktionary_ipa+wikipron | 5670 |
| wiktionary+wiktionary_ipa+wikipron+phonitalia | 17181 |
| wiktionary_ipa | 498 |
| wiktionary_ipa+phonitalia | 58 |
| wiktionary_ipa+wikipron | 103 |
| wiktionary_ipa+wikipron+phonitalia | 150 |

## Code di revisione

| Coda | Record |
| --- | --- |
| revisione_prioritaria | 13704 |
| stime_corroborate | 67730 |
| stime_non_verificate | 433438 |

La prioritaria contiene 2649 conflitti, 11053 DA_RIVEDERE e 2 ambiguita'
automatiche ancora da confermare. Le tre code sono disgiunte e complete per
i record che richiedono revisione. Il totale 514872 NON implica di chiedere
all'autore la revisione uno-a-uno di tutte le stime. Le code servono anche ad audit.
13702 record non hanno un conteggio finale deciso; 2 conservano alternative.

## Audit rispetto alla v1

### vecchi_RISOLTO

| Misura | Grafie |
| --- | --- |
| grafie | 104332 |
| nuovo_stato_DA_RIVEDERE | 3550 |
| conteggio_finale_univoco | 99612 |
| wiktionary_ipa_copertura | 35948 |
| wiktionary_ipa_anomalie | 4245 |
| wikipron_copertura | 39358 |
| wikipron_anomalie | 1235 |
| wikipron_univoche | 38994 |
| wikipron_concordanti | 38758 |
| wikipron_sottostime | 56 |
| wikipron_sovrastime | 180 |
| wikipron_regressioni_rispetto_R1 | 212 |
| nuovo_stato_STIMA_CORROBORATA | 56364 |
| conteggio_finale_concordante | 99612 |
| conteggio_finale_discordante | 0 |
| wiktionary_ipa_univoche | 35920 |
| wiktionary_ipa_concordanti | 35191 |
| wiktionary_ipa_sottostime | 221 |
| wiktionary_ipa_sovrastime | 508 |
| wiktionary_ipa_regressioni_rispetto_R1 | 696 |
| nuovo_stato_RISOLTO | 43248 |
| nuovo_stato_CONFLITTO | 1170 |

### DA_RIVEDERE_con_candidato_unico

| Misura | Grafie |
| --- | --- |
| grafie | 5993 |
| nuovo_stato_DA_RIVEDERE | 5558 |
| conteggio_finale_univoco | 4 |
| wiktionary_ipa_copertura | 1421 |
| wiktionary_ipa_anomalie | 772 |
| wikipron_copertura | 1174 |
| wikipron_anomalie | 772 |
| wiktionary_ipa_univoche | 1408 |
| wiktionary_ipa_concordanti | 1221 |
| wiktionary_ipa_sottostime | 110 |
| wiktionary_ipa_sovrastime | 77 |
| wiktionary_ipa_regressioni_rispetto_R1 | 6 |
| wikipron_univoche | 1088 |
| wikipron_concordanti | 816 |
| wikipron_sottostime | 231 |
| wikipron_sovrastime | 41 |
| wikipron_regressioni_rispetto_R1 | 3 |
| nuovo_stato_CONFLITTO | 431 |
| nuovo_stato_RISOLTO | 4 |
| conteggio_finale_concordante | 4 |
| conteggio_finale_discordante | 0 |

### consenso_W_P_40216

| Misura | Grafie |
| --- | --- |
| grafie | 40216 |
| nuovo_stato_DA_RIVEDERE | 1473 |
| conteggio_finale_univoco | 38115 |
| wiktionary_ipa_copertura | 21975 |
| wiktionary_ipa_anomalie | 1979 |
| wiktionary_ipa_univoche | 21957 |
| wiktionary_ipa_concordanti | 21626 |
| wiktionary_ipa_sottostime | 78 |
| wiktionary_ipa_sovrastime | 253 |
| wiktionary_ipa_regressioni_rispetto_R1 | 298 |
| wikipron_copertura | 24259 |
| wikipron_anomalie | 1024 |
| nuovo_stato_RISOLTO | 38115 |
| conteggio_finale_concordante | 38115 |
| conteggio_finale_discordante | 0 |
| wikipron_univoche | 23999 |
| wikipron_concordanti | 23903 |
| wikipron_sottostime | 21 |
| wikipron_sovrastime | 75 |
| wikipron_regressioni_rispetto_R1 | 72 |
| nuovo_stato_CONFLITTO | 628 |

Nei 40216 vecchi casi W/P concordanti: 38115 restano RISOLTO,
628 diventano CONFLITTO, 1473 DA_RIVEDERE. Tutti i 38115 conteggi finali
univoci mantenuti coincidono con il precedente consenso.
Nei 104332 vecchi RISOLTO: tutti i 99612 conteggi finali univoci mantenuti
coincidono con il precedente dato; zero numeri finali discordanti.
Tutti i 1042 vecchi CONFLITTO restano CONFLITTO: nessuna falsa ambiguita'.
Dei 7051 vecchi DA_RIVEDERE, 4 diventano RISOLTO, 433 CONFLITTO,
6614 restano DA_RIVEDERE. Nel sottoinsieme di 5993 con candidato unico
precedente, i 4 nuovi conteggi finali coincidono con quel candidato.

Le colonne `*_regressioni_rispetto_R1` misurano DISCORDANZE SOSPETTE del
singolo nuovo segnale quando R1 coincideva con il riferimento, non errori
dimostrati del nuovo risultato finale. Su vecchi RISOLTO sono 212 WikiPron
e 696 IPA; nel consenso W/P sono rispettivamente 72 e 298 (non sommare
come grafie distinte). Questi casi richiedono audit linguistico e possono
contenere convenzioni editoriali, varianti o errori di estrazione della fonte.
Non vengono corretti con eccezioni e non vengono trasformati in curatela.

Il benchmark non e' un gold. Il controllo numerico non esclude falsi positivi
nelle stime corroborate e non certifica tutti i 558124 conteggi.

## Campioni stratificati ed esempi

111 strati, 723 record campionati (possibili ripetizioni fra gruppi).

Campionamento deterministico: fino a 8 minimi SHA-256(parola) per gruppo,
tipologia ortografica e combinazione delle nuove evidenze. Gruppi: nuove
corroborate/problematiche, vecchi RISOLTO ora problematici, vecchi CONFLITTO,
DA_RIVEDERE e AMBIGUO. Tipologie: accenti, segni/cifre, i/u adiacenti,
tre vocali, vocali forti adiacenti, grafie semplici/corte e lunghe.

Ispezione tecnica dei campioni rappresentativi: normali forme flesse
`benmeritano [5]`, `fregiati [3]`; forme accentate `servilità [4]`,
prestiti `slang [1]`, `soufflé [2]`, `raid [1]`;
prefissi `tri- [1]`, `ab- [1]`; elisioni `di' [1]`, `'sto [1]`;
tre vocali `ingioiella [4]`, `miao [2]`; composti `medicochirurgico [7]`.
Sono esempi di classificazione automatica, NON approvazioni linguistiche.

Non emergono alterazioni di R1, promozioni a RISOLTO con una sola famiglia,
o numeri finali modificati nei vecchi RISOLTO mantenuti. Restano punti delicati:
conteggio di interiezioni come miao, prestiti/nome proprio/acronimo, prefissi
isolati, convenzioni IPA che omettono accento/glides. Il futuro revisore deve
mostrare l'evidenza e consentire una decisione esplicita dell'autore.
Non e' stata fatta una validazione umana integrale dei campioni.

## Casi reali di controllo

W = hyphenation; P = PhonItalia; IPA = raw locale; WP = WikiPron.
`[]` finale significa nessuna scelta automatica, non zero sillabe.

| Parola | R1 | W | P | IPA | WP | Finale | Stato |
| --- | --- | --- | --- | --- | --- | --- | --- |
| casa | 2 | [2] | [2] | [2] | [2] | [2] | RISOLTO |
| caramella | 4 | [4] | [4] | [4] | [4] | [4] | RISOLTO |
| paura | 2 | [3] | [3] | [3] | [3] | [3] | RISOLTO |
| via | 1 | [2] | [2] | [2] | [2] | [2] | RISOLTO |
| zio | 1 | [2] | [2] | [2] | [2] | [2] | RISOLTO |
| farmacia | 3 | [4] | [4] | [4] | [4] | [4] | RISOLTO |
| bugia | 2 | [3] | [2] | [3] | [2,3] | [] | CONFLITTO |
| regia | 2 | [2,3] | [2,3] | [3] | [2,3] | [2,3] | AMBIGUO |
| balia | 2 | [2,3] | [2,3] | [] | [2,3] | [2,3] | AMBIGUO |
| viola | 2 | [3] | [2,3] | [2,3] | [2,3] | [] | CONFLITTO |
| circuito | 3 | [3,4] | [4] | [3,4] | [3,4] | [] | CONFLITTO |
| miei | 1 | [3] | [2] | [3] | [2] | [] | CONFLITTO |
| tuoi | 1 | [3] | [2] | [3] | [2] | [] | CONFLITTO |
| suoi | 1 | [3] | [2] | [3] | [2] | [] | CONFLITTO |
| noia | 2 | [2] | [2] | [2] | [2] | [2] | RISOLTO |
| aiuola | 3 | [3] | [] | [3] | [3] | [3] | STIMA_CORROBORATA |
| fornaio | 3 | [3] | [3] | [3] | [3] | [3] | RISOLTO |
| poeta | 3 | [3] | [3] | [3] | [3] | [3] | RISOLTO |
| teatro | 3 | [3] | [3] | [3] | [3] | [3] | RISOLTO |
| aereo | 4 | [4] | [4] | [4] | [4] | [4] | RISOLTO |
| gratuito | 3 | [4] | [4] | [4] | [3,4] | [] | CONFLITTO |

`parolastranissima -> 7` verificato separatamente sul runner C++ reale.
`regia` e `balia` mantengono [2,3], nessuna decisione manuale aggiunta.
`bugia`, `viola`, `circuito`, `miei/tuoi/suoi`, `gratuito` non vengono risolti
arbitrariamente. Il confronto mostra anche divergenze lessicali che il solo
conteggio ortografico non puo' risolvere: preservate per la revisione.

## Anomalie e limiti del parser

Conteggi per tipo (una grafia puo' avere piu' anomalie):

| Segnale | Anomalia | Grafie |
| --- | --- | --- |
| wiktionary | parti_incomplete | 58 |
| wiktionary | parti_non_ricompongono_la_grafia | 568 |
| wiktionary | spazi_nelle_parti | 392 |
| wiktionary_ipa | accenti_ipa_consecutivi | 5 |
| wiktionary_ipa | confine_ipa_malformato | 2 |
| wiktionary_ipa | delimitatori_ipa_malformati | 2538 |
| wiktionary_ipa | elementi_ipa_opzionali_o_editoriali | 27 |
| wiktionary_ipa | ipa_senza_nuclei | 5 |
| wiktionary_ipa | legatura_ipa_non_interpretabile | 1 |
| wiktionary_ipa | simbolo_ipa_non_supportato | 1467 |
| wiktionary_ipa | trascrizione_ipa_incompleta | 26 |
| wiktionary_ipa | vocale_non_sillabica_incompatibile | 3 |
| wiktionary_ipa | vocali_adiacenti_non_disambiguate | 1429 |
| wikipron | ipa_senza_nuclei | 25 |
| wikipron | simbolo_ipa_non_supportato | 15 |
| wikipron | vocali_adiacenti_non_disambiguate | 3017 |

Il parser considera j/w non nuclei, vocali IPA, accenti primario/secondario,
vocali non sillabiche, consonanti sillabiche, legature, lunghezza, confini.
Gli spazi tra fonemi NON sono confini sillabici. Conserva alternative e
anche candidati validi accanto a varianti malformate, ma le anomalie impediscono
una certificazione automatica. Non espande arbitrariamente parentesi opzionali.

Durante l'audit sono stati corretti due problemi della nuova pipeline:
possibile mascheramento di un vecchio conflitto tramite unione di alternative,
e falsa anomalia della notazione di lunghezza ASCII `:` nel raw. Entrambi
corretti con regole generali e test, non con eccezioni per regia/viola/aereo.
Trascrizioni editoriali, apostrofo usato come accento e delimitatori irregolari
restano conservativamente segnalati. Ampliare il parser richiedera' nuovi test
e una nuova esecuzione, non una promozione indiscriminata dei candidati.

## Artefatti esterni e verifica

Directory completa: `anagrammi-annotazioni-v2-83f81cdc-verificata`
(artefatti storici esterni al repository).

| Artefatto | Byte | SHA-256 |
| --- | --- | --- |
| annotazioni.jsonl | 613219140 | `b0fbc025ff61775612747e8567ff091c08b1872371c81c15b883d22043b96eaf` |
| campioni_stratificati.json | 1916981 | `ad3c87ee3c00108654f699075adc1a0612a5098ccb58d1b06d476f58382c281f` |
| confronto_prima.json | 66192 | `ed4169d81e0efca45e05c9213ffc08b11de1943d6e4ef3204b78231c440c4b31` |
| decisioni_fuori_vocabolario.json | 3 | `ca3d163bab055381827226140568f3bef7eaac187cebd76878e0b63e9e442356` |
| esclusioni_in_attesa.jsonl | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| revisione_prioritaria.jsonl | 18357076 | `4349feee9eb79183efe67b5e6aafa77a4d968de21d4e28a4e0bc98a407f54f8b` |
| statistiche.json | 12681 | `015646233069f579de7f58899b6fc86a02bae8fa0b06f6db924bc76a32d32aef` |
| stime_corroborate.jsonl | 82747626 | `4f234992b62bd222ba4713e3d68981ce0e0b61295c93eb523b5e662fbaba01f3` |
| stime_non_verificate.jsonl | 451159597 | `9884c27b279598c2943bfcfb5b87d8570cae19d63c83e5b4d1ae5a8a9cf092d7` |

Manifesto SHA-256: `84b13a11fd71f7e81824cc01b8b440fce3a25f0c04dc0c2589ea0d99887a12a0`.

Le annotazioni occupano 613219140 byte. Non sono un pacchetto da caricare
interamente su telefono. Le code ripetono i record per comodita' offline;
nel record si conservano testimoni per conteggio/anomalia e riferimenti di riga,
non tutti i raw. Il futuro confezionamento mobile richiedera' blocchi/indici
piu' piccoli e il rispetto delle licenze dei dati.

Verifica indipendente su TUTTE le 558124 annotazioni: allineamento esatto con
grafie/indici, schemi/politica, origini, stati/famiglie, conteggi e tre code
disgiunte complete. Ricalcolati tutti gli hash di input e artefatti del manifesto.
Esito OK. Verbale esterno:
`anagrammi-v2-verifica-83f81cdc.json` (artefatto locale della verifica storica).

## Test e integrita'

- 41 test Python, tutti superati, nessuno saltato. Include parser/alternative
  IPA, WikiPron/hash, famiglie, stati, conflitti e ambiguita', curatela schema1
  e tutte le azioni, rigenerazione, output esterno, runner obsoleto/protocollo,
  code, manifesto, benchmark/campioni e controlli sul runner reale.
- Runner nativo compilato nuovamente dai sorgenti correnti in C++17.
- Test nativo esistente `tests/sillabe_test.cpp`, compilato C++17: superato,
  compresa la regressione parolastranissima. Nessuna modifica al test C++.
- CTest non disponibile nell'ambiente; nessuna installazione. Non eseguite
  build web/WASM: questa fase riguarda soltanto la pipeline offline.
- VOCABOLARIO: 558124 grafie, 6585461 byte, SHA-256 invariato
  `b3b5703f69874095e9f9ac630ed0a608b919d969d5cd3a6b6477735db8595ad6`.
- Curatela: 77 byte, zero decisioni, SHA-256 invariato
  `7212b40c3a1308f79e220926247a9c6274e30d2e20c99ac8799844d447a71241`.
- Nessuna modifica a core, Unicode, rimario, algoritmi, console, web, WASM,
  persistenza, licenza generale o generatore del vocabolario.
- Confronto degli SHA-256 dei 49 file inizialmente tracciati: solo i tre file
  consentiti risultano modificati; gli altri 46 sono byte-per-byte invariati.

## Formati e futuro revisore mobile/offline

Un record JSONL schema2 per parola conserva indice corrente, R1, quattro
evidenze separate, famiglie, righe/testimoni, anomalie e alternative,
classificazione/motivo automatici, finale/origine/precedenza, eventuale
decisione manuale e priorita' di revisione. La parola e' l'identita'; l'indice
e' soltanto un riferimento nel vocabolario corrente.

Il README documenta, SENZA IMPLEMENTARLO, un futuro formato decision-only:
hash/versioni di vocabolario e curatela di base, commit Git della base,
schema/politica/manifesto, sessione e decisioni per parola con azione,
conteggi, autore, data, note e copia della precedente decisione ufficiale.
Una ripresa offline usa cursore per parola e stato della sessione, separati
dal file ufficiale. I blocchi possono mostrare una parola con le sue evidenze
senza accesso ai raw. Salto temporaneo non equivale a DA_RIVEDERE ufficiale.

Il merge proposto confronta base/corrente/proposta e la storia per parola
dal commit di base: rileva anche modifica e successivo ripristino (ABA).
Non usa last-write-wins o il timestamp del telefono. Con storia insufficiente,
conflitto o base incompatibile richiede intervento esplicito. Le proposte
offline non diventano automaticamente curatela ufficiale.
Nessun revisore, PWA, IndexedDB, import/export UI, merge o sincronizzazione
implementato; nessun override personale.

## Licenze e decisioni rimaste all'autore

Il codice WikiPron e' Apache 2, i DATI derivano da Wiktionary e NON vengono
dichiarati Apache 2. Prima di distribuire pacchetti lessicali/IPA o testimoni
nel futuro revisore occorre verificare attribuzione/share-alike e condizioni
delle edizioni Wiktionary coinvolte. PhonItalia conserva l'indicazione CC BY4.0
e l'attribuzione Goslin/Galuzzi/Romani e Coretta per il package. Il progetto
non cambia licenza. Nessun raw o TSV aggiunto al repository.

Restano decisioni linguistiche dell'autore: varianti realmente ammissibili,
prestiti/acronimi/prefissi isolati, conflitti dei controlli, conferma delle
ambiguita' automatiche e eventuali esclusioni. Le 67730 corroborate non sono
scelte manuali. La tolleranza dei soli avvisi IPA compatibili con un consenso
pulito e la severita' editoriale del parser sono politiche esplicite da
valutare, non un tentativo di stabilire la sillabazione ufficiale al suo posto.

## File e stato Git conclusivo

Modificati: `tools/annota_sillabe.py`, `tools/tests/test_annota_sillabe.py`,
`tools/sillabe/README.md`.
Creati: `tools/evidenze_ipa.py`, `tools/audit_sillabe.py`, questo rapporto.
Solo codice/documentazione nel repository; nessuna nuova annotazione gigante.

Stato finale verificato dopo l'aggiunta del rapporto:

```text
 M tools/annota_sillabe.py
 M tools/sillabe/README.md
 M tools/tests/test_annota_sillabe.py
?? tools/audit_sillabe.py
?? tools/evidenze_ipa.py
?? tools/sillabe/SECONDA_ESECUZIONE.md
```

HEAD resta `295bb80ea35f204535d1c103b6364fba6405cc92`, branch `main`.
Nessun git add, commit, push o deploy. Nessuna decisione di curatela inserita.
