import gzip
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import annota_sillabe as pipeline
from evidenze_ipa import analizza_ipa
from audit_sillabe import AuditPrecedente, CONTROLLI


def evidenza(*conteggi, pronunce=False):
    risultato = pipeline.Evidenza(set(conteggi))
    if pronunce:
        risultato.pronunce = {(f"pronuncia-{n}", 1, n) for n in conteggi}
    return risultato


def decisione(azione, conteggi):
    return {"azione": azione, "conteggi": conteggi, "autore": "Autore di test",
            "data": "2026-10-01", "motivazione": "Fixture, non curatela reale"}


class ClassificazioneTest(unittest.TestCase):
    def test_concordanza_lessicale_prevale_sull_algoritmo(self):
        dato = pipeline.classifica(2, evidenza(3), evidenza(3))
        self.assertEqual((dato["stato"], dato["conteggi"]), ("RISOLTO", [3]))
        self.assertEqual(dato["precedenza"], "evidenza_concordante")

    def test_conflitto_non_diventa_ambiguita(self):
        dato = pipeline.classifica(2, evidenza(3), evidenza(2))
        self.assertEqual(dato["stato"], "CONFLITTO")
        self.assertEqual(dato["conteggi"], [])
        self.assertEqual(dato["candidati_lessicali"], [2, 3])

    def test_alternative_corroborate(self):
        dato = pipeline.classifica(2, evidenza(2, 3), evidenza(2, 3, pronunce=True))
        self.assertEqual((dato["stato"], dato["conteggi"]), ("AMBIGUO", [2, 3]))

    def test_alternative_da_sola_fonte_o_senza_pronunce_da_rivedere(self):
        for w, p in ((evidenza(2, 3), evidenza()), (evidenza(2, 3), evidenza(2, 3))):
            self.assertEqual(pipeline.classifica(2, w, p)["stato"], "DA_RIVEDERE")

    def test_sovrapposizione_parziale_non_risolta(self):
        self.assertEqual(pipeline.classifica(2, evidenza(2, 3), evidenza(3))["stato"],
                         "CONFLITTO")

    def test_solo_stima_e_fonte_singola(self):
        self.assertEqual(pipeline.classifica(7, evidenza(), evidenza())["stato"], "SOLO_STIMA")
        self.assertEqual(pipeline.classifica(2, evidenza(2), evidenza())["stato"], "STIMA_CORROBORATA")
        dato = pipeline.classifica(2, evidenza(3), evidenza())
        self.assertEqual((dato["stato"], dato["conteggi"]), ("DA_RIVEDERE", []))

    def test_anomalia_e_zero(self):
        w = evidenza(2)
        w.anomalie.add("dato_incompleto")
        self.assertEqual(pipeline.classifica(2, w, evidenza(2))["stato"], "DA_RIVEDERE")
        self.assertEqual(pipeline.classifica(0, evidenza(), evidenza())["stato"], "DA_RIVEDERE")

    def test_curatela_ufficiale_prevale_e_preserva_conflitto(self):
        scelta = decisione("CONFERMA", [3])
        for w, p, stima in ((evidenza(3), evidenza(2), 2),
                            (evidenza(4), evidenza(4), 9),
                            (evidenza(), evidenza(), 1)):
            record = pipeline.crea_record(0, "bugia", stima, w, p, scelta)
            self.assertEqual(record["conteggi"], [3])
            self.assertEqual(record["stato"], "RISOLTO")
            self.assertEqual(record["origine"], "curatela_ufficiale")
            self.assertEqual(record["precedenza"], "curatela_ufficiale")
            self.assertEqual(record["decisione_manuale"], scelta)
            self.assertFalse(record["richiede_revisione"])
            self.assertEqual(record["algoritmo"], stima)

    def test_curatela_ambiguita_esclusione_e_rinvio(self):
        for azione, numeri in (("AMBIGUO", [2, 3]), ("ESCLUDI", []), ("DA_RIVEDERE", [])):
            record = pipeline.crea_record(1, "regia", 2, evidenza(2), evidenza(2),
                                         decisione(azione, numeri))
            self.assertEqual((record["stato"], record["conteggi"]), (azione, numeri))
            self.assertEqual(record["esclusione_in_attesa"], azione == "ESCLUDI")
            self.assertEqual(record["richiede_revisione"], azione == "DA_RIVEDERE")

    def test_nuova_modifica_esplicita_puo_correggere_curatela(self):
        argomenti = (0, "bugia", 2, evidenza(3), evidenza(2))
        prima = pipeline.crea_record(*argomenti, decisione("CONFERMA", [3]))
        dopo = pipeline.crea_record(*argomenti, decisione("CONFERMA", [4]))
        self.assertEqual(prima["conteggi"], [3])
        self.assertEqual(dopo["conteggi"], [4])


class FileTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def scrivi(self, nome, testo):
        path = self.root / nome
        path.write_text(testo, encoding="utf-8")
        return path

    def test_curatela_validata_e_chiavi_duplicati_rifiutati(self):
        path = self.scrivi("curatela.json", json.dumps({"schema_version": 1,
            "tipo": "curatela_ufficiale", "decisioni": {"bugia": decisione("CONFERMA", [3])}}))
        self.assertEqual(pipeline.carica_curatela(path)["bugia"]["conteggi"], [3])
        self.scrivi("curatela.json", '{"schema_version":1,"schema_version":1}')
        with self.assertRaises(ValueError):
            pipeline.carica_curatela(path)

    def test_curatela_rifiuta_dati_sospetti(self):
        for campo, valore in (("conteggi", [True]), ("conteggi", [3, 2]),
                             ("conteggi", [3, 3]), ("autore", ""), ("data", "ieri")):
            scelta = decisione("CONFERMA", [3])
            scelta[campo] = valore
            path = self.scrivi("curatela.json", json.dumps({"schema_version": 1,
                "tipo": "curatela_ufficiale", "decisioni": {"bugia": scelta}}))
            with self.assertRaises(ValueError):
                pipeline.carica_curatela(path)

    def test_grafie_accents_e_vocabolario_immutato(self):
        path = self.scrivi("vocabolario.txt", "citta\u0300\n")
        with self.assertRaises(ValueError):
            pipeline.leggi_vocabolario(path)
        path = self.scrivi("vocabolario.txt", "citt\u00e0\ncasa\n")
        prima = path.read_bytes()
        self.assertEqual(pipeline.leggi_vocabolario(path), ["citt\u00e0", "casa"])
        self.assertEqual(prima, path.read_bytes())
        for testo in ("casa\ncasa\n", "due parole\n", "\n"):
            self.scrivi("vocabolario.txt", testo)
            with self.assertRaises(ValueError):
                pipeline.leggi_vocabolario(path)

    def test_wiktionary_nessun_trasferimento_a_flessioni(self):
        rows = [{"lang_code": "it", "word": "casa", "hyphenations": [{"parts": ["ca", "sa"]}],
                 "forms": [{"form": "case"}]},
                {"lang_code": "en", "word": "case", "hyphenations": [{"parts": ["case"]}]},
                {"lang_code": "it", "word": "citt\u00e0", "hyphenations": [{"parts": ["cit", "ta"]}]},
                {"lang_code": "it", "word": "casa", "hyphenations": [{"parts": ["ca", "ne"]}]}]
        path = self.root / "raw.jsonl.gz"
        with gzip.open(path, "wt", encoding="utf-8") as stream:
            stream.write("\n".join(map(json.dumps, rows)))
        dati, stats = pipeline.carica_wiktionary(path, {"casa", "case", "citt\u00e0"})
        self.assertEqual(dati["casa"].conteggi, {2})
        self.assertNotIn("case", dati)
        self.assertEqual(dati["citt\u00e0"].conteggi, {2})
        self.assertIn("parti_non_ricompongono_la_grafia", dati["casa"].anomalie)
        self.assertEqual(stats["sillabazioni_scartate"], 1)

    def test_phonitalia_accents_e_deduplicazione(self):
        path = self.scrivi("phon.tsv", "word\tPhones\tPhoneSyll\tStressedSyllable\tSumSylls\n"
            "citta'\tcitta\tcit-ta\t2\t2\n"
            "citta'\tcitta\tcit-ta\t2\t2\n"
            "perche'\tperke\tper-ke\t2\t2\n")
        dati, stats = pipeline.carica_phonitalia(path, {"citt\u00e0", "perch\u00e9"})
        self.assertEqual(dati["citt\u00e0"].conteggi, {2})
        self.assertEqual(len(dati["citt\u00e0"].pronunce), 1)
        self.assertEqual(dati["citt\u00e0"].righe, {2, 3})
        self.assertEqual(dati["perch\u00e9"].conteggi, {2})
        self.assertEqual(stats["righe"], 3)

    def test_segnaposto_mancante_non_e_dato_malformato(self):
        path = self.scrivi("mancante.jsonl", json.dumps({"word": "esempio", "lang_code": "it",
            "hyphenations": [{"parts": ["divisione in sillabe mancante"]}]}))
        dati, stats = pipeline.carica_wiktionary(path, {"esempio"})
        w = dati["esempio"]
        self.assertEqual(w.conteggi, set())
        self.assertEqual(w.anomalie, set())
        self.assertEqual(w.assenze, {"sillabazione_mancante"})
        self.assertEqual(stats["sillabazioni_dichiarate_mancanti"], 1)
        self.assertEqual(pipeline.classifica(3, w, evidenza())["stato"], "SOLO_STIMA")

    def test_pipeline_rigenerazione_preserva_curatela_ed_esclusione(self):
        vocab = self.scrivi("vocab.txt", "bugia\nregia\nesempio\n")
        wik = self.scrivi("wik.jsonl", json.dumps({"word": "bugia", "lang_code": "it",
                        "hyphenations": [{"parts": ["bu", "gi", "a"]}]}) + "\n")
        phon = self.scrivi("phon.tsv", "word\tPhones\tPhoneSyll\tStressedSyllable\tSumSylls\n"
                          "bugia\tbuja\tbu-ja\t2\t2\n")
        runner = self.scrivi("runner", "fixture")
        fake_repo = self.root / "repo"
        hashes = {}
        for relativo in pipeline.SORGENTI_RUNNER:
            path = fake_repo / relativo
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture sorgente", encoding="utf-8")
            hashes[relativo] = pipeline.sha256_file(path)
        self.scrivi("runner.build.json", json.dumps({"schema_version": 1,
                    "runner_sha256": pipeline.sha256_file(runner), "sorgenti": hashes}))
        decisioni = {"bugia": decisione("CONFERMA", [3]),
                    "regia": decisione("AMBIGUO", [2, 3]),
                    "esempio": decisione("ESCLUDI", []),
                    "assente": decisione("CONFERMA", [3])}
        cura = self.scrivi("curatela.json", json.dumps({"schema_version": 1,
                          "tipo": "curatela_ufficiale", "decisioni": decisioni}))
        originali = {p: p.read_bytes() for p in (vocab, cura)}
        for numero, conteggi in enumerate(([2, 2, 3], [9, 9, 9])):
            output = self.root / f"run-{numero}"
            with patch.object(pipeline, "ROOT", fake_repo), \
                    patch.object(pipeline, "calcola_algoritmo", return_value=conteggi):
                stats = pipeline.esegui_pipeline(vocab, wik, phon, cura, runner, output)
            records = [json.loads(line) for line in (output / "annotazioni.jsonl").read_text(
                       encoding="utf-8").splitlines()]
            self.assertEqual([r["conteggi"] for r in records], [[3], [2, 3], []])
            self.assertEqual(records[0]["automatico"]["stato"], "CONFLITTO")
            self.assertEqual(stats["decisioni_fuori_vocabolario"], 1)
            self.assertEqual(stats["da_revisionare_totale"], 0)
            self.assertEqual(stats["stati"]["ESCLUDI"], 1)
            for nome in ("revisione_prioritaria", "stime_corroborate", "stime_non_verificate"):
                self.assertEqual((output / (nome + ".jsonl")).read_bytes(), b"")
            manifesto = json.loads((output / "manifesto.json").read_text(encoding="utf-8"))
            self.assertEqual(manifesto["compatibilita_vocabolario"]["sha256"],
                             pipeline.sha256_file(vocab))
            for nome, info in manifesto["artefatti"].items():
                self.assertEqual(info["sha256"], pipeline.sha256_file(output / nome))
        for path, originale in originali.items():
            self.assertEqual(path.read_bytes(), originale)
        with self.assertRaises(ValueError):
            pipeline.esegui_pipeline(vocab, wik, phon, cura, runner, self.root / "run-0")
        with patch.object(pipeline, "ROOT", fake_repo):
            self.assertTrue(pipeline.verifica_runner(runner))
            (fake_repo / "core/sillabe.cpp").write_text("cambiato", encoding="utf-8")
            with self.assertRaises(ValueError):
                pipeline.verifica_runner(runner)

    def test_runner_rifiuta_protocollo_incompleto(self):
        with patch.object(pipeline.subprocess, "run") as run:
            run.return_value.stdout = b"2\n"
            with self.assertRaises(ValueError):
                pipeline.calcola_algoritmo(self.root / "runner", ["casa", "oggi"])


class EvidenzeV2Test(unittest.TestCase):
    def test_schemi_separati_curatela_resta_1(self):
        self.assertEqual(pipeline.CURATELA_SCHEMA_VERSION, 1)
        self.assertEqual(pipeline.ANNOTAZIONI_SCHEMA_VERSION, 2)
        self.assertEqual(pipeline.MANIFESTO_SCHEMA_VERSION, 2)

    def test_macro_famiglia_non_conta_segnali_come_voti(self):
        for wik, ipa, wp in ((evidenza(2), evidenza(), evidenza(2)),
                             (evidenza(), evidenza(2), evidenza(2)),
                             (evidenza(2), evidenza(2), evidenza(2))):
            result = pipeline.classifica(2, wik, evidenza(), ipa, wp)
            self.assertEqual(result["stato"], "STIMA_CORROBORATA")
            self.assertEqual(result["macro_famiglie_indipendenti"], 1)

    def test_nuovo_segnale_e_phonitalia_due_famiglie(self):
        for ipa, wp in ((evidenza(3), evidenza()), (evidenza(), evidenza(3))):
            result = pipeline.classifica(2, evidenza(), evidenza(3), ipa, wp)
            self.assertEqual((result["stato"], result["conteggi"]), ("RISOLTO", [3]))
            self.assertEqual(result["macro_famiglie_indipendenti"], 2)

    def test_contrasto_nella_stessa_famiglia_non_ambiguo(self):
        result = pipeline.classifica(2, evidenza(2), evidenza(), evidenza(3), evidenza(2, 3))
        self.assertEqual((result["stato"], result["conteggi"]), ("CONFLITTO", []))
        self.assertTrue(result["contrasto_interno_wiktionary"])

    def test_alternative_subset_non_cancellano_ambiguita_corroborata(self):
        result = pipeline.classifica(2, evidenza(2, 3), evidenza(2, 3, pronunce=True), evidenza(3))
        self.assertEqual((result["stato"], result["conteggi"]), ("AMBIGUO", [2, 3]))
        result = pipeline.classifica(2, evidenza(2), evidenza(), evidenza(2, 3))
        self.assertEqual(result["stato"], "DA_RIVEDERE")

    def test_nuove_alternative_non_cancellano_conflitto_precedente(self):
        result = pipeline.classifica(2, evidenza(3), evidenza(2, 3, pronunce=True), evidenza(2, 3))
        self.assertEqual((result["stato"], result["conteggi"]), ("CONFLITTO", []))
        self.assertEqual(result["motivo"], "hyphenation_phonitalia_discordanti")

    def test_avvertenza_ipa_compatibile_non_distrugge_consenso(self):
        ipa = evidenza(3)
        ipa.anomalie.add("vocali_adiacenti_non_disambiguate")
        result = pipeline.classifica(2, evidenza(2, 3), evidenza(2, 3, pronunce=True), ipa)
        self.assertEqual(result["stato"], "AMBIGUO")
        self.assertEqual(result["avvertenze_compatibili_con_consenso_preesistente"], ["wiktionary_ipa"])
        self.assertEqual(pipeline.classifica(3, evidenza(), evidenza(), ipa)["stato"], "DA_RIVEDERE")
        ipa.anomalie.add("simbolo_ipa_non_supportato")
        self.assertEqual(pipeline.classifica(3, evidenza(3), evidenza(3), ipa)["stato"], "DA_RIVEDERE")

    def test_r1_fonte_contraria_non_promossa(self):
        result = pipeline.classifica(2, evidenza(), evidenza(), evidenza(), evidenza(3))
        self.assertEqual(result["stato"], "DA_RIVEDERE")
        self.assertEqual(result["conteggi"], [])
        self.assertEqual(result["candidati_lessicali"], [3])

    def test_curatela_con_tutte_le_evidenze_contrarie(self):
        for azione, ns in (("CONFERMA", [3]), ("AMBIGUO", [2, 3]), ("DA_RIVEDERE", []), ("ESCLUDI", [])):
            for r1 in (2, 9):
                record = pipeline.crea_record(0, "bugia", r1, evidenza(4), evidenza(5),
                    decisione(azione, ns), ipa=evidenza(6), wikipron=evidenza(7))
                self.assertEqual(record["conteggi"], ns)
                self.assertEqual(record["origine"], "curatela_ufficiale")
                self.assertEqual(record["automatico"]["stato"], "CONFLITTO")
                self.assertEqual(record["wiktionary_ipa"]["conteggi"], [6])

    def test_priorita_distinte(self):
        for w, p, stato, coda in ((evidenza(), evidenza(), "SOLO_STIMA", "stime_non_verificate"),
                                (evidenza(2), evidenza(), "STIMA_CORROBORATA", "stime_corroborate"),
                                (evidenza(2), evidenza(3), "CONFLITTO", "prioritaria")):
            record = pipeline.crea_record(0, "esempio", 2, w, p)
            self.assertEqual((record["stato"], record["priorita_revisione"]), (stato, coda))
            self.assertTrue(record["richiede_revisione"])


class IPATest(unittest.TestCase):
    def test_nuclei_stress_glides_i_diacritica(self):
        for text, count in (("/\u02c8ka.sa/", 2), ("/ka.ra.\u02c8m\u025bl.la/", 4),
                            ("/pa\u02c8u.ra/", 3), ("/\u02c8mjei\u032f/", 1),
                            ("/\u02c8tw\u0254i\u032f/", 1), ("/\u02c8sw\u0254i\u032f/", 1),
                            ("/\u02c8\u0283\u025bn.tsa/", 2), ("/\u02c8n\u0329/", 1)):
            with self.subTest(text=text):
                result = analizza_ipa(text)
                self.assertEqual(result.conteggi, {count})
                self.assertFalse(result.anomalie)

    def test_due_punti_come_lunghezza_fonetica_non_nucleo(self):
        self.assertEqual(analizza_ipa("/a\u02c8\u025b:reo/").conteggi, {4})
        self.assertFalse(analizza_ipa("/a\u02c8\u025b:reo/").anomalie)
        self.assertEqual(analizza_ipa("/a\u02c8\u025b\u02d0reo/").conteggi, {4})
        self.assertTrue(analizza_ipa("/:a/").anomalie)

    def test_alternative_conservate_anche_con_una_malformata(self):
        result = analizza_ipa("/\u02c8r\u025b.d\u0292a/, /re\u02c8d\u0292i.a/")
        self.assertEqual(result.conteggi, {2, 3})
        self.assertFalse(result.anomalie)
        self.assertEqual(len(result.testimoni), 2)
        result = analizza_ipa("/ka.sa/; /???/")
        self.assertEqual(result.conteggi, {2})
        self.assertTrue(result.anomalie)

    def test_vocali_deboli_non_marcate_restano_incerte(self):
        result = analizza_ipa("m j \u025b i", segmentato=True)
        self.assertEqual(result.conteggi, {2})
        self.assertIn("vocali_adiacenti_non_disambiguate", result.anomalie)
        self.assertEqual(analizza_ipa("m j \u025b i\u032f", segmentato=True).conteggi, {1})

    def test_malformati_opzionali_editoriali_non_diventano_certificati(self):
        for text in (None, "", "/ka.sa", "/ka.sa/ etichetta", "[ka.sa", "/k(a)sa/", "IPA: casa",
                     "/123/", "/\u032fka/", "/k\u0361/", "/\u02c8a\u032f/", "/ka../", "k"):
            with self.subTest(text=text):
                result = analizza_ipa(text)
                self.assertFalse(result.conteggi)
                self.assertTrue(result.anomalie)


class FontiV2FileTest(unittest.TestCase):
    setUp = FileTest.setUp
    scrivi = FileTest.scrivi
    def test_wikipron_no_header_deduplicazione_alternative_e_grafia_esatta(self):
        path = self.scrivi("wiki.tsv", "Regia\tr \u025b d\u0292 a\nregia\tr e d\u0292 i . a\n"
            "regia\tr e d\u0292 i . a\ncitta\u0300\tt\u0283 i t . t a\ncasa\t???\n")
        dati, stats = pipeline.carica_wikipron(path, {"regia", "citt\u00e0", "citta", "casa"})
        self.assertEqual(dati["regia"].conteggi, {2, 3})
        self.assertEqual(dati["regia"].righe, {1, 2, 3})
        self.assertNotIn("citta", dati)
        self.assertIn("citt\u00e0", dati)
        self.assertTrue(dati["casa"].anomalie)
        self.assertEqual(stats["righe"], 5)
        self.scrivi("wiki.tsv", "casa\tka sa\textra\n")
        with self.assertRaises(ValueError):
            pipeline.carica_wikipron(path, {"casa"})

    def test_ipa_raw_italiano_esatto_nessuna_flessione(self):
        rows = [{"lang_code": "it", "word": "regia", "sounds": [{"ipa": "/\u02c8r\u025b.d\u0292a/"},
                 {"ipa": "/re\u02c8d\u0292i.a/"}], "forms": [{"form": "regie"}]},
                {"lang_code": "en", "word": "regie", "sounds": [{"ipa": "/ka.sa/"}]},
                {"lang_code": "it", "word": "casa", "sounds": [{"ipa": "(ka)sa"}]}]
        path = self.scrivi("raw.jsonl", "\n".join(map(json.dumps, rows)))
        _, _, ipa, _ = pipeline.carica_wiktionary_completa(path, {"regia", "regie", "casa"})
        self.assertEqual(ipa["regia"].conteggi, {2, 3})
        self.assertNotIn("regie", ipa)
        self.assertTrue(ipa["casa"].anomalie)

    def test_output_dentro_repository_rifiutato_prima_di_runner(self):
        for output in (pipeline.ROOT, pipeline.ROOT / "temp-output"):
            with self.assertRaisesRegex(ValueError, "fuori dal repository"):
                pipeline.esegui_pipeline(*(self.root / "inesistente" for _ in range(5)), output)

    def test_wikipron_hash_errato_rifiutato(self):
        p = self.scrivi("fixture", "test")
        with patch.object(pipeline, "verifica_runner", return_value={}), \
                patch.object(pipeline, "descrivi_file", return_value={"sha256": "errato"}):
            with self.assertRaisesRegex(ValueError, "SHA-256 WikiPron"):
                pipeline.esegui_pipeline(p, p, p, p, p, self.root / "out", wikipron=p)

    def test_audit_transizioni_e_campioni_deterministici(self):
        old = {"indice": 0, "parola": "casa", "algoritmo": 2, "stato": "SOLO_STIMA",
               "conteggi": [2], "wiktionary": {"conteggi": []}, "phonitalia": {"conteggi": []}}
        path = self.scrivi("prima.jsonl", json.dumps(old) + "\n")
        record = pipeline.crea_record(0, "casa", 2, evidenza(), evidenza(), wikipron=evidenza(2))
        audit = AuditPrecedente(path)
        self.addCleanup(audit.close)
        audit.osserva(record)
        result = audit.termina()
        self.assertEqual(result["transizioni"], {"SOLO_STIMA -> STIMA_CORROBORATA": 1})
        self.assertEqual(result["statistiche"]["candidate_numeriche_prima_del_controllo_anomalie"], 1)
        self.assertTrue(audit.campioni_serializzati()["strati"])
        bad = AuditPrecedente(path)
        self.addCleanup(bad.close)
        with self.assertRaisesRegex(ValueError, "non allineate"):
            bad.osserva(dict(record, parola="case"))

    def test_pipeline_v2_code_disgiunte_manifesto_e_integrita(self):
        vocab = self.scrivi("vocab.txt", "casa\npaura\nignota\nbugia\nregia\n")
        wik = self.scrivi("wik.jsonl", "\n".join(json.dumps(row) for row in (
            {"word": "paura", "lang_code": "it", "hyphenations": [{"parts": ["pa", "u", "ra"]}]},
            {"word": "bugia", "lang_code": "it", "hyphenations": [{"parts": ["bu", "gi", "a"]}]},
            {"word": "regia", "lang_code": "it", "hyphenations": [{"parts": ["re", "gia"]},
                {"parts": ["re", "gi", "a"]}], "sounds": [{"ipa": "/re\u02c8d\u0292i.a/"}]})))
        phon = self.scrivi("phon.tsv", "word\tPhones\tPhoneSyll\tStressedSyllable\tSumSylls\n"
            "paura\tpaura\tpa-u-ra\t2\t3\nbugia\tbuja\tbu-ja\t2\t2\n"
            "regia\tredza\tre-dza\t1\t2\nregia\tredzia\tre-dzi-a\t2\t3\n")
        wp = self.scrivi("wikipron.tsv", "casa\tk a z a\npaura\tp a u r a\n"
            "regia\tr \u025b d\u0292 a\nregia\tr e d\u0292 i a\n")
        cura = self.scrivi("cura.json", '{"schema_version":1,"tipo":"curatela_ufficiale","decisioni":{}}')
        runner = self.scrivi("runner", "fixture")
        self.scrivi("runner.build.json", "{}")
        originali = {p: p.read_bytes() for p in (vocab, wik, phon, wp, cura)}
        output = self.root / "seconda"
        with patch.object(pipeline, "verifica_runner", return_value={}), \
                patch.object(pipeline, "calcola_algoritmo", return_value=[2, 2, 3, 2, 2]), \
                patch.object(pipeline, "WIKIPRON_SHA256", pipeline.sha256_file(wp)):
            stats = pipeline.esegui_pipeline(vocab, wik, phon, cura, runner, output, wikipron=wp)
        self.assertEqual({k: v for k, v in stats["stati"].items() if v},
            {"STIMA_CORROBORATA": 1, "RISOLTO": 1, "SOLO_STIMA": 1, "CONFLITTO": 1, "AMBIGUO": 1})
        self.assertEqual(stats["code"], {"stime_corroborate": 1, "stime_non_verificate": 1,
                                         "revisione_prioritaria": 2})
        viste = set()
        for nome in stats["code"]:
            records = [json.loads(line) for line in (output / (nome + ".jsonl")).read_text(encoding="utf-8").splitlines()]
            words = {r["parola"] for r in records}
            self.assertFalse(viste & words)
            viste.update(words)
        manifest = json.loads((output / "manifesto.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["schemi"], {"curatela": 1, "annotazioni": 2, "manifesto": 2})
        self.assertEqual(manifest["input"]["wikipron"]["macro_famiglia"], "wiktionary")
        self.assertIn("NON Apache", manifest["input"]["wikipron"]["licenza_dati"])
        for nome, info in manifest["artefatti"].items():
            self.assertEqual(info["sha256"], pipeline.sha256_file(output / nome))
        for path, before in originali.items():
            self.assertEqual(path.read_bytes(), before)


class RunnerRealeTest(unittest.TestCase):
    @unittest.skipUnless(os.environ.get("ANAGRAMMI_RUNNER"), "Runner reale esterno non indicato")
    def test_tutti_controlli_r1_e_parolastranissima(self):
        runner = Path(os.environ["ANAGRAMMI_RUNNER"])
        pipeline.verifica_runner(runner)
        counts = pipeline.calcola_algoritmo(runner, CONTROLLI + ["parolastranissima"])
        self.assertEqual(len(counts), 22)
        self.assertTrue(all(n > 0 for n in counts))
        self.assertEqual((counts[0], counts[1], counts[-1]), (2, 4, 7))

    @unittest.skipUnless(os.environ.get("ANAGRAMMI_AUDIT_V2"), "Seconda esecuzione non ancora indicata")
    def test_controlli_classificazione_reale(self):
        data = json.loads(Path(os.environ["ANAGRAMMI_AUDIT_V2"]).read_text(encoding="utf-8"))
        self.assertEqual(set(data["controlli"]), set(CONTROLLI))
        for parola in ("regia", "balia"):
            record = data["controlli"][parola]
            self.assertEqual((record["stato"], record["conteggi"]), ("AMBIGUO", [2, 3]))
        for parola in ("bugia", "viola", "circuito"):
            self.assertEqual(data["controlli"][parola]["stato"], "CONFLITTO")
        for record in data["controlli"].values():
            self.assertEqual(record["origine"], "automatico")
            self.assertLessEqual(record["automatico"]["macro_famiglie_indipendenti"], 2)


if __name__ == "__main__":
    unittest.main()
