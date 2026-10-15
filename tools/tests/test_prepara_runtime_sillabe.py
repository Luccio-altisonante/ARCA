import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import prepara_runtime_sillabe as runtime
from annota_sillabe import Evidenza, crea_record


def manual(action, counts):
    return {"azione": action, "conteggi": counts, "autore": "Fixture sintetica",
            "data": "2026-10-04", "motivazione": "Nessuna decisione reale"}


def dump(path, value):
    path.write_bytes(runtime.serializza(value))


def change_header(data, index, value):
    fields = list(runtime.HEADER.unpack_from(data))
    fields[index] = value
    return runtime.HEADER.pack(*fields) + data[runtime.HEADER.size:]


def checksum(data):
    return change_header(bytes(data), 14, hashlib.sha256(data[runtime.HEADER.size:]).digest())


class BinaryTest(unittest.TestCase):
    def build(self, voices=()):
        return runtime.crea_runtime(voices, vocabolario_sha256="a" * 64, annotazioni_sha256="b" * 64)

    def damage(self, data, offset, value, fmt="B"):
        data = bytearray(data)
        struct.pack_into("<" + fmt, data, offset, value)
        return checksum(data)

    def test_layout_header_metadata_directory_bitmap(self):
        self.assertEqual((runtime.HEADER.size, runtime.META.size, runtime.DIRECTORY.size), (192, 8, 16))
        data = self.build([runtime.VoceSillabica((2, 3), "AMBIGUO", algoritmo=2)])
        self.assertEqual(len(data), 234)
        self.assertEqual(data[:8], b"SILLBM\x00\x00")
        self.assertEqual(data[8:12], b"\x01\x00\xc0\x00")
        header = runtime.HEADER.unpack_from(data)
        self.assertEqual(header[4:12], (1, 2, 2, 1, 192, 200, 232, 234))
        self.assertEqual(data[192:200], struct.pack("<I4B", 2, 6, 1, 0, 0))
        self.assertEqual(data[200:232], struct.pack("<IIQIIQ", 2, 1, 232, 3, 1, 233))
        self.assertEqual(data[232:], b"\x01\x01")

    def test_zero_parole(self):
        data = self.build()
        loaded = runtime.valida_runtime(data, grafie=0)
        self.assertEqual(len(data), 192)
        self.assertEqual((loaded.numero_grafie, loaded.numero_conteggi, loaded.numero_conteggi_distinti,
                          loaded.bitmap_stride), (0, 0, 0, 0))
        self.assertEqual(loaded.statistiche()["conteggio_massimo_osservato"], 0)
        self.assertEqual(list(loaded.indici_compatibili(2)), [])
        with self.assertRaises(ValueError):
            loaded.compatibile(0, 2)

    def test_una_parola_e_ambiguita(self):
        voice = runtime.VoceSillabica((2, 3), "AMBIGUO", "curatela_ufficiale", 2)
        loaded = runtime.valida_runtime(self.build([voice]))
        self.assertEqual(loaded.voce(0), voice)
        self.assertTrue(loaded.compatibile(0, 2))
        self.assertTrue(loaded.compatibile(0, 3))
        self.assertFalse(loaded.compatibile(0, 4))
        self.assertEqual(list(loaded.indici_compatibili(3)), [0])
        self.assertEqual(list(loaded.indici_compatibili(4)), [])

    def test_n_multiplo_e_non_multiplo_di_otto_k_uno(self):
        for n in (1, 8, 9, 16, 17):
            voices = [runtime.VoceSillabica((2,), "SOLO_STIMA", algoritmo=2)] * n
            loaded = runtime.valida_runtime(self.build(voices))
            self.assertEqual(loaded.bitmap_stride, (n + 7) // 8)
            self.assertEqual(loaded.numero_conteggi_distinti, 1)
            self.assertEqual(list(loaded.indici_compatibili(2)), list(range(n)))

    def test_k_zero_con_voci(self):
        voices = [runtime.VoceSillabica((), "CONFLITTO", algoritmo=2),
                  runtime.VoceSillabica((), "ESCLUDI", "curatela_ufficiale", 2)]
        data = self.build(voices)
        loaded = runtime.valida_runtime(data)
        self.assertEqual(len(data), 192 + 8 * 2)
        self.assertEqual(loaded.numero_conteggi_distinti, 0)
        self.assertEqual([loaded.voce(i) for i in range(2)], voices)

    def test_molte_parole_roundtrip(self):
        voices = [runtime.VoceSillabica((i % 90 + 1,), "SOLO_STIMA", algoritmo=i % 90 + 1)
                  for i in range(2000)]
        loaded = runtime.valida_runtime(self.build(voices))
        self.assertEqual(loaded.numero_grafie, len(voices))
        self.assertEqual([loaded.voce(i) for i in range(len(voices))], voices)
        self.assertEqual(loaded.numero_conteggi_distinti, 90)

    def test_stati_origine_esclusione_derivata_e_r1(self):
        voices = [runtime.VoceSillabica((2,), "RISOLTO", "curatela_ufficiale", 3),
                  runtime.VoceSillabica((2,), "STIMA_CORROBORATA", algoritmo=2),
                  runtime.VoceSillabica((2,), "SOLO_STIMA", algoritmo=2),
                  runtime.VoceSillabica((), "CONFLITTO", algoritmo=2),
                  runtime.VoceSillabica((), "DA_RIVEDERE", "curatela_ufficiale", 2),
                  runtime.VoceSillabica((2, 3, 7), "AMBIGUO", "curatela_ufficiale", 2),
                  runtime.VoceSillabica((), "ESCLUDI", "curatela_ufficiale", 2)]
        loaded = runtime.valida_runtime(self.build(voices))
        self.assertEqual([loaded.voce(i) for i in range(7)], voices)
        self.assertEqual(loaded.statistiche()["stati"], {state: 1 for state in runtime.STATI})
        self.assertEqual(loaded.statistiche()["parole_con_0_conteggi"], 3)
        self.assertEqual(loaded.statistiche()["parole_con_1_conteggio"], 3)
        self.assertEqual(loaded.statistiche()["parole_con_piu_conteggi"], 1)
        self.assertFalse(loaded.compatibile(3, 2))
        self.assertFalse(loaded.compatibile(6, 2))
        self.assertTrue(loaded.compatibile(2, 2))
        self.assertEqual(list(loaded.indici_compatibili(2)), [0, 1, 2, 5])
        self.assertEqual(list(loaded.indici_compatibili(7)), [5])

    def test_esclusione_senza_campo_indipendente(self):
        voice = runtime.VoceSillabica((), "ESCLUDI", "curatela_ufficiale")
        self.assertTrue(voice.esclusione_in_attesa)
        self.assertNotIn("esclusione_in_attesa", voice.__dict__)
        with self.assertRaises(AttributeError):
            voice.esclusione_in_attesa = False
        with self.assertRaises(TypeError):
            runtime.VoceSillabica((), "ESCLUDI", esclusione_in_attesa=False)

    def test_conteggi_dispersi_uint32_max(self):
        values = (2, 3, 7, 1000, runtime.UINT32_MAX)
        voice = runtime.VoceSillabica(values, "AMBIGUO", algoritmo=runtime.UINT32_MAX)
        data = self.build([voice])
        loaded = runtime.valida_runtime(data)
        self.assertEqual(loaded.voce(0), voice)
        self.assertEqual(loaded.numero_conteggi_distinti, 5)
        self.assertEqual(len(data), 192 + 8 + 16 * 5 + 5)
        for value in values:
            self.assertTrue(loaded.compatibile(0, value))
        with self.assertRaisesRegex(ValueError, "uint32"):
            self.build([runtime.VoceSillabica((runtime.UINT32_MAX + 1,), "RISOLTO")])

    def test_bool_float_zero_duplicati_non_ordinati_rifiutati(self):
        for counts, state in (((True,), "RISOLTO"), ((2.0,), "RISOLTO"), ((0,), "RISOLTO"),
                              ((-1,), "RISOLTO"), ((3, 2), "AMBIGUO"), ((2, 2), "AMBIGUO")):
            with self.subTest(counts=counts), self.assertRaises(ValueError):
                self.build([runtime.VoceSillabica(counts, state)])

    def test_metadati_e_cardinalita_illegali(self):
        for voice in (runtime.VoceSillabica((), "RISOLTO"), runtime.VoceSillabica((2,), "AMBIGUO"),
                      runtime.VoceSillabica((2,), "CONFLITTO"), runtime.VoceSillabica((2,), "ESCLUDI"),
                      runtime.VoceSillabica((2,), "DA_RIVEDERE"),
                      runtime.VoceSillabica((2,), "IGNOTO"), runtime.VoceSillabica((2,), "RISOLTO", "ignota"),
                      runtime.VoceSillabica((2,), "RISOLTO", algoritmo=True),
                      runtime.VoceSillabica((2,), "SOLO_STIMA", "curatela_ufficiale")):
            with self.subTest(voice=voice), self.assertRaises(ValueError):
                self.build([voice])

    def test_hash_grafie_corretti_e_incompatibili(self):
        data = self.build([runtime.VoceSillabica((2,), "RISOLTO")])
        loaded = runtime.valida_runtime(data, vocabolario_sha256="a" * 64, annotazioni_sha256="b" * 64,
                                        grafie=1, artifact_sha256=runtime.digest(data))
        self.assertEqual(loaded.annotazioni_sha256, "b" * 64)
        for args in ({"vocabolario_sha256": "c" * 64}, {"annotazioni_sha256": "c" * 64},
                     {"grafie": 2}, {"grafie": True}, {"artifact_sha256": "c" * 64},
                     {"vocabolario_sha256": "non-hash"}, {"annotazioni_sha256": "non-hash"}):
            with self.subTest(args=args), self.assertRaises(ValueError):
                runtime.valida_runtime(data, **args)

    def test_magic_versione_header_riservati(self):
        data = self.build()
        for index, value in ((0, b"BADMAGIC"), (0, b"SILLRT\x00\x00"), (1, 2), (2, 160),
                              (3, 1), (15, b"\x01" * 32)):
            with self.subTest(index=index), self.assertRaises(ValueError):
                runtime.valida_runtime(change_header(data, index, value))

    def test_troncato_byte_extra_lunghezza_offset_grafie(self):
        data = self.build([runtime.VoceSillabica((2,), "RISOLTO")])
        cases = [data[:n] for n in (0, 4, 191, 192, len(data) - 1)] + [data + b"\x00"]
        header = runtime.HEADER.unpack_from(data)
        cases += [change_header(data, i, header[i] + 1) for i in range(4, 12)]
        cases.append(change_header(data, 11, runtime.UINT64_MAX))
        for damaged in cases:
            with self.subTest(length=len(damaged)), self.assertRaises(ValueError):
                runtime.valida_runtime(damaged)

    def test_overflow_e_limiti_layout(self):
        with self.assertRaises(ValueError):
            runtime.uint64(runtime.UINT64_MAX + 1)
        for n, k in ((runtime.UINT32_MAX + 1, 0), (0, runtime.UINT32_MAX + 1), (-1, 0)):
            with self.assertRaises(ValueError):
                runtime.layout(n, k)
        stride, _, _, length = runtime.layout(runtime.UINT32_MAX, runtime.UINT32_MAX)
        self.assertEqual(stride, 536870912)
        self.assertLess(length, runtime.UINT64_MAX)

    def test_corruzione_payload_rilevata(self):
        data = bytearray(self.build([runtime.VoceSillabica((2,), "RISOLTO")]))
        data[-1] ^= 1
        with self.assertRaisesRegex(ValueError, "Checksum"):
            runtime.valida_runtime(bytes(data))

    def test_codici_e_metadata_riservati_con_checksum_ricalcolato(self):
        valid = self.build([runtime.VoceSillabica((2, 3), "AMBIGUO")])
        for field, value in ((4, 0), (4, 255), (5, 0), (5, 3), (6, 1), (7, 1)):
            with self.subTest(field=field), self.assertRaises(ValueError):
                runtime.valida_runtime(self.damage(valid, 192 + field, value))

    def test_directory_zero_duplicato_fuori_ordine(self):
        data = self.build([runtime.VoceSillabica((2, 3), "AMBIGUO")])
        directory = runtime.HEADER.unpack_from(data)[9]
        for offset, value in ((directory, 0), (directory + 16, 2), (directory + 16, 1)):
            with self.subTest(offset=offset, value=value), self.assertRaises(ValueError):
                runtime.valida_runtime(self.damage(data, offset, value, "I"))

    def test_offset_directory_gap_overlap_fuori_file(self):
        data = self.build([runtime.VoceSillabica((2, 3), "AMBIGUO")])
        header = runtime.HEADER.unpack_from(data)
        directory, start = header[9], header[10]
        for offset in (start, start + 2, len(data), runtime.UINT64_MAX):
            with self.subTest(offset=offset), self.assertRaises(ValueError):
                runtime.valida_runtime(self.damage(data, directory + 16 + 8, offset, "Q"))

    def test_popolazione_errata_e_colonna_vuota(self):
        data = self.build([runtime.VoceSillabica((2,), "RISOLTO")])
        header = runtime.HEADER.unpack_from(data)
        for population in (0, 2):
            with self.subTest(population=population), self.assertRaises(ValueError):
                runtime.valida_runtime(self.damage(data, header[9] + 4, population, "I"))
        with self.assertRaises(ValueError):
            runtime.valida_runtime(self.damage(data, header[10], 0))

    def test_padding_finale_non_zero(self):
        data = self.build([runtime.VoceSillabica((2,), "RISOLTO")] * 9)
        header = runtime.HEADER.unpack_from(data)
        with self.assertRaisesRegex(ValueError, "padding"):
            runtime.valida_runtime(self.damage(data, header[10] + 1, 0x81))

    def test_semantica_per_parola_escludi_conflitto_rinvio_con_bit(self):
        data = self.build([runtime.VoceSillabica((2,), "RISOLTO")])
        for state in ("ESCLUDI", "CONFLITTO", "DA_RIVEDERE", "AMBIGUO"):
            with self.subTest(state=state), self.assertRaisesRegex(ValueError, "Cardinalita"):
                runtime.valida_runtime(self.damage(data, 192 + 4, runtime.STATE_IDS[state]))
        empty = self.build([runtime.VoceSillabica((), "DA_RIVEDERE")])
        with self.assertRaisesRegex(ValueError, "Cardinalita"):
            runtime.valida_runtime(self.damage(empty, 192 + 4, runtime.STATE_IDS["RISOLTO"]))

    def test_origine_manuale_incoerente(self):
        data = self.build([runtime.VoceSillabica((2,), "SOLO_STIMA")])
        with self.assertRaises(ValueError):
            runtime.valida_runtime(self.damage(data, 192 + 5, runtime.ORIGIN_IDS["curatela_ufficiale"]))

    def test_query_input_invalidi(self):
        loaded = runtime.valida_runtime(self.build([runtime.VoceSillabica((2,), "RISOLTO")]))
        for index, number in ((-1, 2), (1, 2), (True, 2), (0, True), (0, 0), (0, 2.0), (0, runtime.UINT32_MAX + 1)):
            with self.subTest(index=index, number=number), self.assertRaises(ValueError):
                loaded.compatibile(index, number)
        for number in (0, True, 2.0, runtime.UINT32_MAX + 1):
            with self.assertRaises(ValueError):
                loaded.indici_compatibili(number)
        with self.assertRaises(ValueError):
            loaded.voce(-1)

    def test_filtro_globale_non_chiama_query_individuali(self):
        data = self.build([runtime.VoceSillabica((2,), "RISOLTO")] * 17)
        loaded = runtime.valida_runtime(data)
        with patch.object(loaded, "compatibile", side_effect=AssertionError("N query vietate")):
            self.assertEqual(list(loaded.indici_compatibili(2)), list(range(17)))

    def test_memoria_temporanea_non_restata_e_nessuna_mappa_parole(self):
        loaded = runtime.valida_runtime(self.build([runtime.VoceSillabica((2, 3), "AMBIGUO")]))
        self.assertEqual(set(loaded.__dict__), {"_data", "numero_grafie", "numero_conteggi",
            "numero_conteggi_distinti", "bitmap_stride", "_stride", "_keys", "_offsets",
            "vocabolario_sha256", "annotazioni_sha256"})
        self.assertEqual(loaded._keys, (2, 3))
        with self.assertRaises(ValueError):
            runtime.valida_runtime(bytearray(loaded._data))

    def test_determinismo_buffer(self):
        voices = [runtime.VoceSillabica((2, 3), "AMBIGUO")]
        self.assertEqual(self.build(voices), self.build(iter(voices)))

    def test_benchmark_piccolo_query_equivalenti(self):
        report = runtime.benchmark_sintetico(70, 100)
        self.assertEqual(set(report["rappresentazioni"]), {"bitmap_v1"})
        self.assertGreater(report["rappresentazioni"]["bitmap_v1"]["match"], 0)


class GeneratorTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="runtime-sillabe-sintetico-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.vocab = self.root / "vocabolario.txt"
        self.annotations = self.root / "annotazioni.jsonl"
        self.manifest = self.root / "manifesto.json"
        self.artifact = self.root / "runtime.bin"
        self.output = self.root / "runtime.json"
        self.words = ["casa", "regia", "buono", "fatto", "bugia", "poeta", "viola", "via"]
        empty = Evidenza()
        self.records = [crea_record(0, "casa", 2, Evidenza({2}), Evidenza({2})),
                        crea_record(1, "regia", 2, empty, empty, manual("AMBIGUO", [2, 3])),
                        crea_record(2, "buono", 2, empty, empty),
                        crea_record(3, "fatto", 2, empty, empty, manual("ESCLUDI", [])),
                        crea_record(4, "bugia", 2, Evidenza({2}), Evidenza({3})),
                        crea_record(5, "poeta", 2, empty, empty, manual("CONFERMA", [3])),
                        crea_record(6, "viola", 2, Evidenza({2}), empty),
                        crea_record(7, "via", 0, empty, empty)]
        self.write_sources()

    def write_sources(self):
        self.vocab.write_text("".join(word + "\n" for word in self.words), encoding="utf-8")
        self.annotations.write_bytes(b"".join((json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
                                              for r in self.records))
        self.manifest_data = {"schema_version": 2, "politica_version": "offline-v2-evidenze",
                              "schemi": {"curatela": 1, "annotazioni": 2, "manifesto": 2},
                              "input": {"vocabolario": {"sha256": runtime.sha256_file(self.vocab)},
                                        "curatela": {"sha256": "a" * 64, "percorso": "backup_non_letto.json"}},
                              "compatibilita_vocabolario": {"sha256": runtime.sha256_file(self.vocab), "grafie": len(self.words)},
                              "artefatti": {"annotazioni.jsonl": {"percorso": "annotazioni.jsonl",
                                           "sha256": runtime.sha256_file(self.annotations), "byte": self.annotations.stat().st_size}}}
        dump(self.manifest, self.manifest_data)

    def generate(self, **options):
        args = dict(vocabolario=self.vocab, annotazioni=self.annotations, manifesto_input=self.manifest,
                    artifact=self.artifact, manifesto_output=self.output)
        args.update(options)
        return runtime.genera(**args)

    def test_generatore_lettore_stats_ambiguita_esclusione(self):
        result = self.generate()
        loaded = runtime.verifica_artifact(self.artifact, self.output, vocabolario=self.vocab)
        self.assertEqual(loaded.numero_grafie, 8)
        self.assertEqual(loaded.voce(1).conteggi, (2, 3))
        self.assertTrue(loaded.compatibile(1, 2))
        self.assertTrue(loaded.compatibile(1, 3))
        self.assertFalse(loaded.compatibile(1, 4))
        self.assertEqual(loaded.voce(3).stato, "ESCLUDI")
        self.assertEqual(loaded.voce(3).conteggi, ())
        self.assertFalse(loaded.compatibile(3, 2))
        self.assertEqual(loaded.voce(5).conteggi, (3,))
        self.assertEqual(loaded.voce(5).algoritmo, 2)
        self.assertEqual(result["artifact_sha256"], runtime.sha256_file(self.artifact))
        self.assertEqual(result["artifact_byte"], self.artifact.stat().st_size)
        self.assertEqual(result["statistiche"]["stati"], {state: 2 if state == "RISOLTO" else 1 for state in runtime.STATI})
        self.assertEqual(result["configurazione"]["selezione_stati"], "nessuna")
        self.assertEqual((result["formato"], result["numero_conteggi_distinti"],
                          result["numero_conteggi"], result["bitmap_stride"]),
                         ("sillabe-bitmap-le-v1", 2, 6, 1))
        self.assertEqual(list(loaded.indici_compatibili(2)), [0, 1, 2, 6])
        self.assertNotIn(b"casa", self.artifact.read_bytes())

    def test_zero_parole_generatore(self):
        self.words, self.records = [], []
        self.write_sources()
        result = self.generate()
        self.assertEqual(result["artifact_byte"], 192)
        self.assertEqual(result["numero_grafie"], 0)
        self.assertEqual(runtime.verifica_artifact(self.artifact, self.output).numero_grafie, 0)

    def test_ordine_input_preservato_senza_ordinamento_python(self):
        self.words = ["viola", "casa"]
        self.records = [crea_record(0, "viola", 2, Evidenza(), Evidenza()),
                        crea_record(1, "casa", 3, Evidenza(), Evidenza())]
        self.write_sources()
        self.generate()
        loaded = runtime.leggi_runtime(self.artifact)
        self.assertTrue(loaded.compatibile(0, 2))
        self.assertTrue(loaded.compatibile(1, 3))

    def test_unicode_canonico_no_trasformazioni(self):
        self.words = ["citt\u00e0", "l'acqua"]
        self.records = [crea_record(i, word, 2, Evidenza(), Evidenza()) for i, word in enumerate(self.words)]
        self.write_sources()
        original = self.vocab.read_bytes()
        self.generate()
        self.assertEqual(self.vocab.read_bytes(), original)

    def test_indice_booleano_duplicato_fuori_ordine_parola_errata(self):
        original = copy.deepcopy(self.records)
        for key, value in (("indice", True), ("indice", 0), ("indice", 30), ("parola", "altra"), ("schema_version", True)):
            self.records = copy.deepcopy(original)
            self.records[1][key] = value
            self.write_sources()
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                self.generate()
            self.assertFalse(self.artifact.exists())

    def test_annotazioni_mancanti_extra(self):
        self.records.pop()
        self.write_sources()
        with self.assertRaises(ValueError):
            self.generate()
        self.records.extend([crea_record(7, "via", 2, Evidenza(), Evidenza()),
                             crea_record(8, "altra", 2, Evidenza(), Evidenza())])
        self.write_sources()
        with self.assertRaises(ValueError):
            self.generate()

    def test_curatela_da_rivedere_e_priorita_manuale(self):
        self.records[0] = crea_record(0, "casa", 2, Evidenza({2}), Evidenza({2}), manual("DA_RIVEDERE", []))
        self.write_sources()
        self.generate()
        loaded = runtime.leggi_runtime(self.artifact)
        self.assertEqual(loaded.voce(0).stato, "DA_RIVEDERE")
        self.assertEqual(loaded.voce(0).origine, "curatela_ufficiale")
        self.assertEqual(loaded.voce(0).algoritmo, 2)
        self.assertFalse(loaded.compatibile(0, 2))

    def test_decisione_manuale_incoerente_non_ricalcolata(self):
        self.records[1]["conteggi"] = [2, 4]
        self.write_sources()
        with self.assertRaisesRegex(ValueError, "manuale"):
            self.generate()

    def test_automatico_incoerente_rifiutato(self):
        self.records[0]["conteggi"] = [3]
        self.write_sources()
        with self.assertRaisesRegex(ValueError, "automatica"):
            self.generate()

    def test_flag_upstream_verificato_ma_non_memorizzato(self):
        original = copy.deepcopy(self.records)
        for index, value in ((0, True), (3, False), (0, 0)):
            self.records = copy.deepcopy(original)
            self.records[index]["esclusione_in_attesa"] = value
            self.write_sources()
            with self.subTest(index=index, value=value), self.assertRaisesRegex(ValueError, "esclusione"):
                self.generate()

    def test_conteggi_input_illegali_rifiutati(self):
        original = copy.deepcopy(self.records)
        for values in ([True], [0], [2.0], [3, 2], [2, 2], [runtime.UINT32_MAX + 1]):
            self.records = copy.deepcopy(original)
            self.records[0]["conteggi"] = values
            self.records[0]["automatico"]["conteggi"] = values
            self.write_sources()
            with self.subTest(values=values), self.assertRaises(ValueError):
                self.generate()

    def test_sezioni_manifest_malformate_rifiutate(self):
        original = copy.deepcopy(self.manifest_data)
        for key, value in (("compatibilita_vocabolario", None), ("input", []), ("artefatti", None)):
            self.manifest_data = copy.deepcopy(original)
            self.manifest_data[key] = value
            dump(self.manifest, self.manifest_data)
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.generate()

    def test_json_duplicate_nan_rifiutati(self):
        for data in (b'{"indice":0,"indice":1}\n', b'{"indice":NaN}\n'):
            self.annotations.write_bytes(data)
            self.manifest_data["artefatti"]["annotazioni.jsonl"].update(
                sha256=runtime.sha256_file(self.annotations), byte=len(data))
            dump(self.manifest, self.manifest_data)
            with self.assertRaises(ValueError):
                self.generate()

    def test_base_hash_dimensioni_versioni_incompatibili(self):
        original = copy.deepcopy(self.manifest_data)
        for change in (lambda m: m.update(schema_version=True), lambda m: m.update(politica_version="altra"),
                       lambda m: m["schemi"].update(annotazioni=True),
                       lambda m: m["compatibilita_vocabolario"].update(grafie=9),
                       lambda m: m["compatibilita_vocabolario"].update(sha256="0" * 64),
                       lambda m: m["artefatti"]["annotazioni.jsonl"].update(sha256="0" * 64),
                       lambda m: m["artefatti"]["annotazioni.jsonl"].update(byte=0)):
            self.manifest_data = copy.deepcopy(original)
            change(self.manifest_data)
            dump(self.manifest, self.manifest_data)
            with self.assertRaises(ValueError):
                self.generate()
            self.assertFalse(self.artifact.exists())

    def test_vocabolario_non_canonico_duplicato(self):
        for words in (["CASA"], ["casa", "casa"], ["ca sa"], ["citta\u0300"], [""]):
            self.words = words
            self.records = [crea_record(i, word, 2, Evidenza(), Evidenza()) for i, word in enumerate(words)]
            self.write_sources()
            with self.subTest(words=words), self.assertRaises(ValueError):
                self.generate()

    def test_input_invariati_manifest_no_percorsi_backup(self):
        before = {p: p.read_bytes() for p in (self.vocab, self.annotations, self.manifest)}
        self.generate()
        self.assertEqual(before, {p: p.read_bytes() for p in before})
        self.assertFalse((self.root / "backup_non_letto.json").exists())
        self.assertNotIn("backup_non_letto", self.output.read_text())

    def test_determinismo_artifact_e_manifest_nomi_output_diversi(self):
        self.generate()
        second_bin, second_json = self.root / "second.bin", self.root / "second.json"
        self.generate(artifact=second_bin, manifesto_output=second_json)
        self.assertEqual(self.artifact.read_bytes(), second_bin.read_bytes())
        self.assertEqual(self.output.read_bytes(), second_json.read_bytes())

    def test_output_esistente_non_sovrascritto(self):
        self.artifact.write_bytes(b"ORIGINALE")
        with self.assertRaisesRegex(ValueError, "esistente"):
            self.generate()
        self.assertEqual(self.artifact.read_bytes(), b"ORIGINALE")
        self.assertFalse(self.output.exists())
        self.artifact.unlink()
        self.output.write_bytes(b"ORIGINALE")
        with self.assertRaisesRegex(ValueError, "esistente"):
            self.generate()
        self.assertFalse(self.artifact.exists())

    def test_output_in_repository_o_input_rifiutati(self):
        for options in ({"artifact": runtime.ROOT / "runtime-vietato.bin"},
                        {"manifesto_output": runtime.ROOT / "runtime-vietato.json"},
                        {"artifact": self.vocab}, {"artifact": self.output},
                        {"artifact": runtime.ROOT / "dist/runtime-vietato.bin"}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.generate(**options)
        self.assertFalse((runtime.ROOT / "runtime-vietato.bin").exists())
        self.assertFalse(self.artifact.exists())

    def test_input_cambiato_durante_generazione_rifiutato(self):
        original = runtime.crea_runtime

        def mutate(*args, **kwargs):
            data = original(*args, **kwargs)
            self.annotations.write_bytes(self.annotations.read_bytes() + b"\n")
            return data

        with patch.object(runtime, "crea_runtime", mutate), self.assertRaisesRegex(ValueError, "Input cambiato"):
            self.generate()
        self.assertFalse(self.artifact.exists())

    def test_race_output_non_sovrascrive_e_ripulisce_solo_propri_file(self):
        original = runtime.valida_runtime

        def race(*args, **kwargs):
            loaded = original(*args, **kwargs)
            self.output.write_bytes(b"ALTRO PROCESSO")
            return loaded

        with patch.object(runtime, "valida_runtime", race), self.assertRaises(FileExistsError):
            self.generate()
        self.assertEqual(self.output.read_bytes(), b"ALTRO PROCESSO")
        self.assertFalse(self.artifact.exists())

    def test_manifest_runtime_corrotto(self):
        self.generate()
        original = json.loads(self.output.read_bytes())
        for key, value in (("artifact_sha256", "0" * 64), ("numero_grafie", 9),
                           ("artifact_byte", 1), ("numero_conteggi", 0), ("runtime_version", 2),
                           ("numero_conteggi_distinti", 3), ("bitmap_stride", 2),
                           ("numero_conteggi_distinti", True), ("bitmap_stride", True),
                           ("formato", "sillabe-indicizzate-le-v1"), ("manifesto_pipeline_sha256", "invalid"),
                           ("politica_pipeline", "altra"), ("configurazione", {}),
                           ("hash_sorgenti_dichiarati", {"vocabolario": "invalid"}),
                           ("annotazioni_sha256", "0" * 64), ("vocabolario_sha256", "0" * 64)):
            changed = copy.deepcopy(original)
            changed[key] = value
            dump(self.output, changed)
            with self.subTest(key=key), self.assertRaises(ValueError):
                runtime.verifica_artifact(self.artifact, self.output)
        changed = copy.deepcopy(original)
        changed["statistiche"]["stati"]["STIMA_CORROBORATA"] = True
        dump(self.output, changed)
        with self.assertRaises(ValueError):
            runtime.verifica_artifact(self.artifact, self.output)

    def test_cli_generazione_e_verifica(self):
        script = runtime.ROOT / "tools/prepara_runtime_sillabe.py"
        result = subprocess.run([sys.executable, "-B", str(script), "genera", "--vocabolario", str(self.vocab),
                                 "--annotazioni", str(self.annotations), "--manifesto-input", str(self.manifest),
                                 "--artifact", str(self.artifact), "--manifesto-output", str(self.output)], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        result = subprocess.run([sys.executable, "-B", str(script), "verifica", "--artifact", str(self.artifact),
                                 "--manifesto", str(self.output), "--vocabolario", str(self.vocab)], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())


class PublicationTest(unittest.TestCase):
    write_sources = GeneratorTest.write_sources
    generate = GeneratorTest.generate

    def setUp(self):
        GeneratorTest.setUp(self)
        self.offline = self.generate()
        self.package = self.root / "pacchetto-web"

    def publish(self, **options):
        args = dict(artifact=self.artifact, manifesto=self.output,
                    vocabolario=self.vocab, output=self.package)
        args.update(options)
        return runtime.pubblica_web(**args)

    def test_pacchetto_esatto_nome_copia_e_input_invariati(self):
        original = {p: p.read_bytes() for p in (self.artifact, self.output, self.vocab)}
        result = self.publish()
        sha = runtime.sha256_file(self.artifact)
        expected = {"schema": 1, "disponibile": True, "formato": runtime.FORMAT,
                    "artifact": f"runtime-sillabe-{sha}.bin", "artifact_sha256": sha,
                    "vocabolario_sha256": runtime.sha256_file(self.vocab),
                    "annotazioni_sha256": self.offline["annotazioni_sha256"],
                    "numero_grafie": len(self.words), "dimensione_byte": self.artifact.stat().st_size}
        self.assertEqual(result, expected)
        self.assertEqual({p.name for p in self.package.iterdir()},
                         {result["artifact"], "runtime-sillabe.manifest.json"})
        self.assertEqual((self.package / result["artifact"]).read_bytes(), original[self.artifact])
        self.assertEqual((self.package / "runtime-sillabe.manifest.json").read_bytes(), runtime.serializza(expected))
        self.assertEqual(original, {p: p.read_bytes() for p in original})

    def test_pubblicazioni_indipendenti_identiche(self):
        result = self.publish()
        second = self.root / "altro-pacchetto"
        self.assertEqual(self.publish(output=second), result)
        for name in (result["artifact"], "runtime-sillabe.manifest.json"):
            self.assertEqual((self.package / name).read_bytes(), (second / name).read_bytes())

    def test_artifact_alterato_rifiutato(self):
        data = bytearray(self.artifact.read_bytes())
        data[-1] ^= 1
        self.artifact.write_bytes(data)
        with self.assertRaises(ValueError):
            self.publish()
        self.assertFalse(self.package.exists())

    def test_manifest_offline_incompatibile_rifiutato(self):
        for key, value in (("schema_version", 2), ("artifact_sha256", "0" * 64),
                           ("artifact_byte", 1), ("configurazione", {}),
                           ("vocabolario_sha256", "0" * 64), ("formato", "altro")):
            changed = copy.deepcopy(self.offline)
            changed[key] = value
            dump(self.output, changed)
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.publish()
            self.assertFalse(self.package.exists())

    def test_vocabolario_errato_rifiutato(self):
        self.vocab.write_bytes(b"altro\n")
        with self.assertRaises(ValueError):
            self.publish()
        self.assertFalse(self.package.exists())

    def test_output_interno_repository_o_input_rifiutati(self):
        for output in (runtime.ROOT / "pacchetto-vietato", runtime.ROOT / "web/data/pacchetto-vietato",
                       self.vocab, self.artifact, self.output):
            with self.subTest(output=output), self.assertRaises(ValueError):
                self.publish(output=output)
        self.assertFalse(self.package.exists())

    def test_output_pre_esistente_nessun_overwrite(self):
        self.package.mkdir()
        saved = self.package / "runtime-sillabe.manifest.json"
        saved.write_bytes(b"ORIGINALE")
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(saved.read_bytes(), b"ORIGINALE")
        self.assertEqual(list(self.package.iterdir()), [saved])
        saved.unlink()
        self.package.rmdir()
        self.package.write_bytes(b"FILE ORIGINALE")
        with self.assertRaises(ValueError):
            self.publish()
        self.assertEqual(self.package.read_bytes(), b"FILE ORIGINALE")

    def test_fallimento_seconda_scrittura_rimuove_pacchetto(self):
        with patch.object(runtime.os, "fsync", side_effect=[None, OSError("Scrittura interrotta")]), \
                self.assertRaisesRegex(OSError, "interrotta"):
            self.publish()
        self.assertFalse(self.package.exists())
        self.assertEqual(runtime.sha256_file(self.artifact), self.offline["artifact_sha256"])

    def test_copia_corrotto_hash_e_dimensione_verificati(self):
        original = runtime.sha256_file
        for content in (b"corto", bytes(self.artifact.stat().st_size)):
            def corrupt(path):
                if path.parent == self.package and path.suffix == ".bin":
                    path.write_bytes(content)
                return original(path)

            with self.subTest(byte=len(content)), patch.object(runtime, "sha256_file", corrupt), \
                    self.assertRaisesRegex(ValueError, "Copia artifact"):
                self.publish()
            self.assertFalse(self.package.exists())

    def test_input_cambiato_durante_copia_rimuove_pacchetto(self):
        original = runtime.os.fsync

        def mutate(fd):
            original(fd)
            self.vocab.write_bytes(b"modificato\n")

        with patch.object(runtime.os, "fsync", mutate), self.assertRaisesRegex(ValueError, "Input cambiato"):
            self.publish()
        self.assertFalse(self.package.exists())

    def test_race_directory_non_sovrascritta(self):
        original = runtime.verifica_artifact

        def race(*args, **kwargs):
            loaded = original(*args, **kwargs)
            self.package.mkdir()
            (self.package / "altro").write_bytes(b"ALTRO PROCESSO")
            return loaded

        with patch.object(runtime, "verifica_artifact", race), self.assertRaises(FileExistsError):
            self.publish()
        self.assertEqual((self.package / "altro").read_bytes(), b"ALTRO PROCESSO")

    def test_vocabolario_vuoto_valido_offline_non_pubblicabile_web(self):
        self.words, self.records = [], []
        self.write_sources()
        self.artifact.unlink()
        self.output.unlink()
        self.generate()
        with self.assertRaisesRegex(ValueError, "vuoto"):
            self.publish()
        self.assertFalse(self.package.exists())

    def test_cli_pubblica_web(self):
        script = runtime.ROOT / "tools/prepara_runtime_sillabe.py"
        result = subprocess.run([sys.executable, "-B", str(script), "pubblica-web", "--artifact",
                                 str(self.artifact), "--manifesto", str(self.output), "--vocabolario",
                                 str(self.vocab), "--output", str(self.package)], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(json.loads(result.stdout), json.loads((self.package / "runtime-sillabe.manifest.json").read_bytes()))

    def web_contract(self, executable, code, manifest):
        env = dict(os.environ, ANAGRAMMI_PUBLICATION=str(manifest),
                   ANAGRAMMI_REPOSITORY=str(runtime.ROOT))
        return subprocess.run(executable + [code], env=env, capture_output=True, text=True)

    def test_contratto_reale_app_js(self):
        node = shutil.which("node")
        if node is None:
            self.skipTest("Node non disponibile per il contratto reale web")
        self.publish()
        code = r'''
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(process.env.ANAGRAMMI_REPOSITORY + '/web/app.js', 'utf8');
const start = source.indexOf('function validaManifestSillabe(');
const end = source.indexOf('function generazioneOriginaleAttiva(', start);
if (start < 0 || end <= start) throw Error('Validatore reale non individuato');
const validate = new vm.Script(source.slice(start, end) + '\nvalidaManifestSillabe;').runInNewContext();
validate(JSON.parse(fs.readFileSync(process.env.ANAGRAMMI_PUBLICATION, 'utf8')));
'''
        manifest = self.package / "runtime-sillabe.manifest.json"
        self.assertEqual(self.web_contract([node, "-e"], code, manifest).returncode, 0)
        self.assertNotEqual(self.web_contract([node, "-e"], code, self.output).returncode, 0)
        original = json.loads(manifest.read_bytes())
        for key, value in (("schema", True), ("artifact", "runtime.bin"), ("numero_grafie", 0),
                           ("artifact_sha256", "A" * 64), ("dimensione_byte", -1)):
            changed = dict(original, **{key: value})
            dump(manifest, changed)
            with self.subTest(key=key):
                self.assertNotEqual(self.web_contract([node, "-e"], code, manifest).returncode, 0)

    def test_contratto_reale_build_powershell(self):
        pwsh = shutil.which("pwsh")
        if pwsh is None:
            self.skipTest("PowerShell non disponibile per le precondizioni reali della build")
        self.publish()
        code = r'''
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $env:ANAGRAMMI_REPOSITORY 'web/build.ps1'), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Build PowerShell non parsabile' }
$function = $ast.Find({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Test-PositiveInteger' }, $true)
if (-not $function) { throw 'Helper reale non individuato' }
$parts = @($function.Extent.Text); $collect = $false; $ended = $false
foreach ($statement in $ast.EndBlock.Statements) {
    if ($statement -is [System.Management.Automation.Language.AssignmentStatementAst]) {
        if ($statement.Left.Extent.Text -eq '$runtimeManifest') { $collect = $true }
        if ($collect -and $statement.Left.Extent.Text -eq '$env:Path') { $ended = $true; break }
    }
    if ($collect) { $parts += $statement.Extent.Text }
}
if (-not $ended -or $parts.Count -lt 5) { throw 'Precondizioni reali non individuate' }
$runtimeManifestPath = $env:ANAGRAMMI_PUBLICATION
$dataDirectory = Split-Path -Parent $runtimeManifestPath
& ([scriptblock]::Create($parts -join "`n"))
'''
        manifest = self.package / "runtime-sillabe.manifest.json"
        command = [pwsh, "-NoProfile", "-NonInteractive", "-Command"]
        accepted = self.web_contract(command, code, manifest)
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertNotEqual(self.web_contract(command, code, self.output).returncode, 0)
        original = json.loads(manifest.read_bytes())
        for key, value in (("schema", True), ("artifact", "runtime.bin"), ("numero_grafie", 0),
                           ("artifact_sha256", "A" * 64), ("dimensione_byte", -1)):
            dump(manifest, dict(original, **{key: value}))
            with self.subTest(key=key):
                self.assertNotEqual(self.web_contract(command, code, manifest).returncode, 0)


if __name__ == "__main__":
    unittest.main()
