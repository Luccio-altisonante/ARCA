import hashlib
from pathlib import Path
import struct
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import annota_sillabe as pipeline
import confronta_runtime_sillabe as bitmap
import prepara_runtime_sillabe as record


def voci():
    return [record.VoceSillabica((2,), "RISOLTO", "curatela_ufficiale", 9),
            record.VoceSillabica((3,), "STIMA_CORROBORATA", algoritmo=3),
            record.VoceSillabica((7,), "SOLO_STIMA", algoritmo=7),
            record.VoceSillabica((), "CONFLITTO", algoritmo=2),
            record.VoceSillabica((), "DA_RIVEDERE", "curatela_ufficiale", 5),
            record.VoceSillabica((2, 3, 1000, record.UINT32_MAX), "AMBIGUO", "curatela_ufficiale", 1),
            record.VoceSillabica((), "ESCLUDI", "curatela_ufficiale", 2)]


def crea(voices):
    return bitmap.crea_bitmap(voices, vocabolario_sha256=bitmap.VH, annotazioni_sha256=bitmap.AH)


def header_modificato(data, **fields):
    values = list(bitmap.HEADER.unpack_from(data))
    for index, value in fields.items():
        values[int(index)] = value
    return bitmap.HEADER.pack(*values) + data[bitmap.HEADER.size:]


def payload_modificato(data, offset, value, fmt="B"):
    result = bytearray(data)
    struct.pack_into("<" + fmt, result, offset, value)
    header = list(bitmap.HEADER.unpack_from(result))
    header[14] = hashlib.sha256(result[bitmap.HEADER.size:]).digest()
    result[:bitmap.HEADER.size] = bitmap.HEADER.pack(*header)
    return bytes(result)


class UpstreamTest(unittest.TestCase):
    def test_cardinalita_automatica_e_candidati_separati(self):
        def e(*counts, pronunce=False):
            result = pipeline.Evidenza(set(counts))
            if pronunce:
                result.pronunce = {(str(n), 1, n) for n in counts}
            return result
        cases = [(2, e(3), e(3), "RISOLTO", [3]),
                 (2, e(2), e(), "STIMA_CORROBORATA", [2]),
                 (7, e(), e(), "SOLO_STIMA", [7]),
                 (2, e(3), e(2), "CONFLITTO", []),
                 (2, e(3), e(), "DA_RIVEDERE", []),
                 (2, e(2, 3), e(2, 3, pronunce=True), "AMBIGUO", [2, 3])]
        for r1, wik, phon, state, counts in cases:
            with self.subTest(state=state):
                row = pipeline.crea_record(0, "fixture", r1, wik, phon)
                self.assertEqual((row["stato"], row["conteggi"]), (state, counts))
                self.assertFalse(row["esclusione_in_attesa"])
                record.voce_da_record(row)
                if state in ("CONFLITTO", "DA_RIVEDERE"):
                    self.assertTrue(row["automatico"]["candidati_lessicali"])

    def test_esclusione_derivabile_per_tutte_le_azioni_manuali(self):
        for action, counts in (("CONFERMA", [3]), ("AMBIGUO", [2, 3]),
                               ("DA_RIVEDERE", []), ("ESCLUDI", [])):
            decision = {"azione": action, "conteggi": counts, "autore": "Fixture",
                        "data": "2026-10-04", "motivazione": "Solo test sintetico"}
            row = pipeline.crea_record(0, "fixture", 2, pipeline.Evidenza({3}),
                                       pipeline.Evidenza({2}), decision)
            self.assertEqual(row["esclusione_in_attesa"], row["stato"] == "ESCLUDI")
            voice = record.voce_da_record(row)
            self.assertEqual(bitmap.valida_bitmap(crea([voice])).voce(0), voice)


class BitmapTest(unittest.TestCase):
    def setUp(self):
        self.data = crea(voci())
        self.header = bitmap.HEADER.unpack_from(self.data)
        self.directory_at = self.header[9]
        self.bitmap_at = self.header[10]

    def test_layout_e_valori_uint32_dispersi(self):
        self.assertEqual((bitmap.HEADER.size, bitmap.META.size, bitmap.DIRECTORY.size), (192, 8, 16))
        self.assertEqual((self.header[4], self.header[5], self.header[6], self.header[7]), (7, 5, 7, 1))
        self.assertEqual(len(self.data), 192 + 8 * 7 + 16 * 5 + 5)
        runtime = bitmap.valida_bitmap(self.data)
        self.assertEqual(runtime._keys, (2, 3, 7, 1000, record.UINT32_MAX))

    def test_roundtrip_tutte_le_informazioni(self):
        checks = dict(vocabolario_sha256=bitmap.VH, grafie=7, artifact_sha256=record.digest(self.data))
        runtime = bitmap.valida_bitmap(self.data, **checks)
        original = bitmap.valida_record_pool(bitmap.crea_record_pool(voci(), vocabolario_sha256=bitmap.VH,
                                                            annotazioni_sha256=bitmap.AH))
        self.assertEqual(runtime.annotazioni_sha256, original.annotazioni_sha256)
        for i, voice in enumerate(voci()):
            self.assertEqual(runtime.voce(i), voice)
            self.assertEqual(runtime.voce(i), original.voce(i))
            for count in (1, 2, 3, 7, 999, 1000, record.UINT32_MAX):
                self.assertEqual(runtime.compatibile(i, count), count in voice.conteggi)
        self.assertEqual(list(runtime.indici_compatibili(2)), [0, 5])
        self.assertEqual(list(runtime.indici_compatibili(1000)), [5])
        self.assertEqual(list(runtime.indici_compatibili(999)), [])

    def test_bitmap_ufficiale_identica_al_prototipo(self):
        data = record.crea_runtime(voci(), vocabolario_sha256=bitmap.VH, annotazioni_sha256=bitmap.AH)
        self.assertEqual(data, self.data)
        official = record.valida_runtime(data, vocabolario_sha256=bitmap.VH,
                                         annotazioni_sha256=bitmap.AH, grafie=7,
                                         artifact_sha256=record.digest(data))
        baseline = bitmap.valida_record_pool(bitmap.crea_record_pool(
            voci(), vocabolario_sha256=bitmap.VH, annotazioni_sha256=bitmap.AH))
        self.assertEqual(official.statistiche(), baseline.statistiche())
        self.assertEqual([official.voce(i) for i in range(7)], voci())

    def test_artifact_vuoto(self):
        data = crea([])
        runtime = bitmap.valida_bitmap(data)
        self.assertEqual(len(data), 192)
        self.assertEqual(runtime.numero_grafie, 0)
        self.assertEqual(list(runtime.indici_compatibili(2)), [])

    def test_solo_voci_senza_conteggi(self):
        voices = [record.VoceSillabica((), "DA_RIVEDERE"),
                  record.VoceSillabica((), "ESCLUDI")]
        runtime = bitmap.valida_bitmap(crea(voices))
        self.assertEqual(runtime._keys, ())
        self.assertEqual([runtime.voce(i) for i in range(2)], voices)

    def test_determinismo(self):
        self.assertEqual(self.data, crea(iter(voci())))

    def test_piu_byte_bitmap_e_nessun_limite_63(self):
        voices = [record.VoceSillabica((i + 1,), "RISOLTO") for i in range(70)]
        data = crea(voices)
        runtime = bitmap.valida_bitmap(data)
        self.assertEqual(runtime._stride, 9)
        self.assertEqual(len(runtime._keys), 70)
        self.assertEqual(len(data), 192 + 8 * 70 + 16 * 70 + 70 * 9)
        for i, voice in enumerate(voices):
            self.assertEqual(runtime.voce(i), voice)
            self.assertEqual(list(runtime.indici_compatibili(i + 1)), [i])

    def test_input_non_valido(self):
        for voice in (record.VoceSillabica((2, 2), "AMBIGUO"),
                      record.VoceSillabica((3, 2), "AMBIGUO"),
                      record.VoceSillabica((0,), "RISOLTO"),
                      record.VoceSillabica((True,), "RISOLTO"),
                      record.VoceSillabica((record.UINT32_MAX + 1,), "RISOLTO"),
                      record.VoceSillabica((2,), "CONFLITTO"),
                      record.VoceSillabica((2,), "SOLO_STIMA", "curatela_ufficiale")):
            with self.subTest(voice=voice), self.assertRaises(ValueError):
                crea([voice])

    def test_buffer_indici_e_query_invalidi(self):
        with self.assertRaises(ValueError):
            bitmap.valida_bitmap(bytearray(self.data))
        runtime = bitmap.valida_bitmap(self.data)
        for index in (-1, 7, True, 0.5):
            with self.subTest(index=index), self.assertRaises(ValueError):
                runtime.voce(index)
            with self.assertRaises(ValueError):
                runtime.compatibile(index, 2)
        for count in (0, -1, True, record.UINT32_MAX + 1):
            with self.subTest(count=count), self.assertRaises(ValueError):
                runtime.compatibile(0, count)
            with self.assertRaises(ValueError):
                list(runtime.indici_compatibili(count))

    def test_magic_versione_header_riservati(self):
        for index, value in ((0, b"WRONG000"), (1, 2), (2, 160), (3, 1), (15, b"x" * 32)):
            with self.subTest(index=index), self.assertRaises(ValueError):
                bitmap.valida_bitmap(header_modificato(self.data, **{str(index): value}))

    def test_offset_stride_e_cardinalita_header(self):
        for index in (4, 5, 6, 7, 8, 9, 10, 11):
            with self.subTest(index=index), self.assertRaises(ValueError):
                bitmap.valida_bitmap(header_modificato(self.data, **{str(index): self.header[index] + 1}))

    def test_troncamento_ed_extra(self):
        for data in (b"", self.data[:191], self.data[:-1], self.data + b"x"):
            with self.subTest(size=len(data)), self.assertRaises(ValueError):
                bitmap.valida_bitmap(data)

    def test_hash_e_snapshot(self):
        for kwargs in (dict(vocabolario_sha256=bitmap.AH), dict(grafie=8),
                       dict(artifact_sha256=bitmap.VH), dict(vocabolario_sha256="invalid")):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                bitmap.valida_bitmap(self.data, **kwargs)
        changed = header_modificato(self.data, **{"13": bytes(32)})
        with self.assertRaises(ValueError):
            bitmap.valida_bitmap(changed, artifact_sha256=record.digest(self.data))

    def test_checksum(self):
        data = bytearray(self.data)
        data[-1] ^= 1
        with self.assertRaises(ValueError):
            bitmap.valida_bitmap(bytes(data))

    def test_directory_conteggi_zero_duplicati_non_ordinati(self):
        for offset, value in ((self.directory_at, 0), (self.directory_at + 16, 2),
                              (self.directory_at + 16, 1)):
            with self.subTest(offset=offset, value=value), self.assertRaises(ValueError):
                bitmap.valida_bitmap(payload_modificato(self.data, offset, value, "I"))

    def test_popolazione_non_valida_o_non_corrispondente(self):
        for population in (0, 1, 8):
            with self.subTest(population=population), self.assertRaises(ValueError):
                bitmap.valida_bitmap(payload_modificato(self.data, self.directory_at + 4, population, "I"))

    def test_offset_bitmap_non_canonico(self):
        with self.assertRaises(ValueError):
            bitmap.valida_bitmap(payload_modificato(self.data, self.directory_at + 8, self.bitmap_at + 1, "Q"))

    def test_padding_non_nullo(self):
        with self.assertRaises(ValueError):
            bitmap.valida_bitmap(payload_modificato(self.data, self.bitmap_at,
                                                    self.data[self.bitmap_at] | 128))

    def test_codici_e_riservati_metadata(self):
        for field, value in ((4, 0), (4, 8), (5, 0), (5, 3), (6, 1), (7, 1)):
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                bitmap.valida_bitmap(payload_modificato(self.data, bitmap.HEADER.size + field, value))

    def test_stato_cardinalita_e_origine_incoerenti(self):
        for offset, value in ((bitmap.HEADER.size + 4, record.STATE_IDS["CONFLITTO"]),
                              (bitmap.HEADER.size + 4, record.STATE_IDS["AMBIGUO"]),
                              (bitmap.HEADER.size + bitmap.META.size + 5, 2)):
            with self.subTest(offset=offset), self.assertRaises(ValueError):
                bitmap.valida_bitmap(payload_modificato(self.data, offset, value))

    def test_bitmap_vuota_non_e_una_colonna_valida(self):
        with self.assertRaises(ValueError):
            bitmap.valida_bitmap(payload_modificato(self.data, self.bitmap_at, 0))

    def test_benchmark_equivalente_quattro_scenari(self):
        reports = bitmap.benchmark(n=70, queries=100, repeats=1)
        self.assertEqual([r["scenario"] for r in reports], list(bitmap.SCENARI))
        self.assertEqual(reports[-1]["K"], 4)
        for report in reports:
            for name in ("record_pool", "bitmap"):
                self.assertGreater(report[name]["raw"], 0)
                self.assertIn("validazione_ms", report[name])


if __name__ == "__main__":
    unittest.main()
