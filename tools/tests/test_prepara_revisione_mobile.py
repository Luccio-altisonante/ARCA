import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import prepara_revisione_mobile as mobile
from annota_sillabe import Evidenza, crea_record


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


class PackagingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="sillabe-mobile-test-")
        self.root = Path(self.temp.name)
        self.curatela = self.root / "curatela.json"
        dump(self.curatela, {"schema_version": 1, "tipo": "curatela_ufficiale", "decisioni": {}})
        self.records = [crea_record(i, word, 2, Evidenza(conteggi={3}), Evidenza(conteggi={2}))
                        for i, word in enumerate(["bugia", "viola", "circuito"])]
        self.manifesto = self.root / "manifesto.json"
        self.write_sources()

    def tearDown(self):
        self.temp.cleanup()

    def write_sources(self, coda="revisione_prioritaria"):
        queue = self.root / (coda + ".jsonl")
        queue.write_text("".join(json.dumps(r) + "\n" for r in self.records), encoding="utf-8")
        self.manifest = {"schema_version": 2, "politica_version": "offline-v2-evidenze",
                         "schemi": {"curatela": 1, "annotazioni": 2, "manifesto": 2},
                         "input": {"curatela": {"sha256": mobile.sha256_file(self.curatela)},
                                   "vocabolario": {"sha256": "a" * 64}},
                         "compatibilita_vocabolario": {"sha256": "a" * 64, "grafie": 3},
                         "artefatti": {queue.name: {"percorso": queue.name, "sha256": mobile.sha256_file(queue), "byte": queue.stat().st_size}}}
        dump(self.manifesto, self.manifest)

    def prepare(self, **options):
        out = self.root / ("out-" + str(len(list(self.root.glob("out-*")))) + ".json")
        result = mobile.prepara(self.manifesto, self.curatela, out, **options)
        return json.loads(out.read_text(encoding="utf-8")), result

    def test_pacchetto_valido_schema_base_ordine_e_conteggio(self):
        data, result = self.prepare(git_base="b" * 40)
        self.assertEqual(data["schema_version"], 1)
        self.assertEqual(data["tipo"], "pacchetto_revisione_sillabe")
        self.assertEqual(data["base"]["manifesto_sha256"], mobile.sha256_file(self.manifesto))
        self.assertEqual(data["base"]["curatela_sha256"], mobile.sha256_file(self.curatela))
        self.assertEqual(data["base"]["vocabolario_sha256"], "a" * 64)
        self.assertEqual(data["base"]["curatela_revisione_git_base"], "b" * 40)
        self.assertEqual([r["parola"] for r in data["record"]], ["bugia", "viola", "circuito"])
        self.assertEqual(result["record"], 3)
        self.assertEqual(result["sha256"], mobile.sha256_file(Path(result["percorso"])))

    def test_scelta_altre_code(self):
        for queue, priority in [("stime_corroborate", "stime_corroborate"), ("stime_non_verificate", "stime_non_verificate")]:
            for r in self.records:
                r["priorita_revisione"] = priority
            self.write_sources(queue)
            data, _ = self.prepare(coda=queue)
            self.assertEqual(data["coda"], queue)

    def test_duplicate_rifiutate(self):
        self.records[1]["parola"] = "bugia"
        self.write_sources()
        with self.assertRaisesRegex(ValueError, "duplicata"):
            self.prepare()

    def test_record_malformati_rifiutati(self):
        original = copy.deepcopy(self.records)
        for key, value in [("parola", "BUGIA"), ("indice", True), ("algoritmo", -1), ("schema_version", 1), ("priorita_revisione", "nessuna")]:
            self.records = copy.deepcopy(original); self.records[0][key] = value; self.write_sources()
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.prepare()

    def test_testimoni_non_validi(self):
        self.records[0]["wiktionary"]["testimoni_sillabazioni"] = {"3": "raw"}
        self.write_sources()
        with self.assertRaises(ValueError):
            self.prepare()

    def test_famiglie_e_candidati_coerenti(self):
        self.records[0]["automatico"]["macro_famiglie"]["wiktionary"] = [2]
        self.write_sources()
        with self.assertRaisesRegex(ValueError, "coerenti"):
            self.prepare()

    def test_curatela_associata_per_parola_non_indice(self):
        decision = {"azione": "CONFERMA", "conteggi": [4], "autore": "Autore", "data": "2026-10-02", "motivazione": "Decisione fixture"}
        dump(self.curatela, {"schema_version": 1, "tipo": "curatela_ufficiale", "decisioni": {"viola": decision}})
        self.write_sources()
        data, _ = self.prepare()
        self.assertIsNone(data["record"][0]["decisione_base"])
        self.assertEqual(data["record"][1]["decisione_base"], decision)

    def test_output_repository_rifiutato(self):
        with self.assertRaisesRegex(ValueError, "fuori repository"):
            mobile.prepara(self.manifesto, self.curatela, mobile.ROOT / "forbidden.json")
        self.assertFalse((mobile.ROOT / "forbidden.json").exists())

    def test_input_non_modificati_raw_non_copiato(self):
        self.records[0]["raw_grandissimo"] = "DATO_RAW" * 1000
        self.records[0]["wiktionary"]["righe"] = list(range(1000))
        self.write_sources()
        paths = [self.manifesto, self.curatela, self.root / "revisione_prioritaria.jsonl"]
        before = [mobile.sha256_file(p) for p in paths]
        data, result = self.prepare()
        self.assertEqual(before, [mobile.sha256_file(p) for p in paths])
        text = Path(result["percorso"]).read_text(encoding="utf-8")
        self.assertNotIn("DATO_RAW", text)
        self.assertNotIn('"righe"', text)

    def test_intervallo_deterministico(self):
        data, _ = self.prepare(offset=1, limite=1)
        self.assertEqual([r["parola"] for r in data["record"]], ["viola"])
        self.assertEqual(data["intervallo"], {"offset": 1, "record_coda": 3})

    def test_hash_coda_curatela_schema_manifesto(self):
        for case in ["coda", "curatela", "schema"]:
            self.write_sources()
            if case == "coda":
                with (self.root / "revisione_prioritaria.jsonl").open("a") as stream: stream.write("{}\n")
            elif case == "curatela":
                self.curatela.write_text(self.curatela.read_text() + " ")
            else:
                self.manifest["schema_version"] = 1; dump(self.manifesto, self.manifest)
            with self.subTest(case=case), self.assertRaises(ValueError):
                self.prepare()

    def test_output_esistente_non_sovrascritto(self):
        path = self.root / "existing.json"; path.write_text("ORIGINALE")
        with self.assertRaisesRegex(ValueError, "esistente"):
            mobile.prepara(self.manifesto, self.curatela, path)
        self.assertEqual(path.read_text(), "ORIGINALE")

    def test_json_chiavi_duplicate_rifiutate(self):
        self.manifesto.write_text('{"schema_version":2,"schema_version":1}')
        with self.assertRaises(ValueError): self.prepare()

    def test_limiti_dimensioni_e_ordine(self):
        self.records[1]["indice"] = 0; self.write_sources()
        with self.assertRaises(ValueError): self.prepare()
        with self.assertRaises(ValueError): self.prepare(limite=0)


if __name__ == "__main__":
    unittest.main()
