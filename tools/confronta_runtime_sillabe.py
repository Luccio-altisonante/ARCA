#!/usr/bin/env python3
"""Esperimento isolato: bitmap validata contro record+pool, solo dati sintetici."""

from __future__ import annotations

import argparse
from array import array
from bisect import bisect_left
from collections import Counter
import gzip
import hashlib
import json
import random
import statistics
import struct
import time
import zlib

import prepara_runtime_sillabe as record


MAGIC = b"SILLBM\x00\x00"
VERSION = 1  # Versione sperimentale, non il contratto runtime di produzione.
HEADER = struct.Struct("<8sHHIIIIIQQQQ32s32s32s32s")
META = struct.Struct("<I4B")
DIRECTORY = struct.Struct("<IIQ")
require = record.require
VH, AH = "a" * 64, "b" * 64


# Solo baseline storica dell'esperimento: il generatore ufficiale non la importa.
LEGACY_MAGIC = b"SILLRT\x00\x00"
LEGACY_VERSION = 1
LEGACY_HEADER = struct.Struct("<8sHHIIIQQQ32s32s32s16s")
LEGACY_RECORD = struct.Struct("<III4B")


def crea_record_pool(voci, *, vocabolario_sha256, annotazioni_sha256):
    record.hash_valido(vocabolario_sha256)
    record.hash_valido(annotazioni_sha256)
    records, counts = bytearray(), bytearray()
    n = m = 0
    for voce in voci:
        record.valida_voce(voce)
        record.intero(n + 1)
        record.intero(m + len(voce.conteggi))
        records.extend(LEGACY_RECORD.pack(m, len(voce.conteggi), voce.algoritmo,
                                   record.STATE_IDS[voce.stato], record.ORIGIN_IDS[voce.origine],
                                   int(voce.esclusione_in_attesa), 0))
        for value in voce.conteggi:
            counts.extend(record.U32.pack(value))
        n += 1
        m += len(voce.conteggi)
    payload = bytes(records + counts)
    offset_counts = LEGACY_HEADER.size + LEGACY_RECORD.size * n
    header = LEGACY_HEADER.pack(LEGACY_MAGIC, LEGACY_VERSION, LEGACY_HEADER.size, 0, n, m, LEGACY_HEADER.size,
                         offset_counts, LEGACY_HEADER.size + len(payload),
                         bytes.fromhex(vocabolario_sha256), bytes.fromhex(annotazioni_sha256),
                         hashlib.sha256(payload).digest(), b"\x00" * 16)
    return header + payload


class RuntimeRecordPool:
    """Buffer immutabile gia' validato; indice zero-based dello snapshot."""

    def __init__(self, data, n, m, counts_offset, vocab_hash, annotations_hash):
        self._data = data
        self.numero_grafie = n
        self.numero_conteggi = m
        self._counts_offset = counts_offset
        self.vocabolario_sha256 = vocab_hash
        self.annotazioni_sha256 = annotations_hash

    def _record(self, indice):
        require(type(indice) is int and 0 <= indice < self.numero_grafie, "Indice parola fuori range")
        return LEGACY_RECORD.unpack_from(self._data, LEGACY_HEADER.size + LEGACY_RECORD.size * indice)

    def voce(self, indice):
        start, k, r1, state, origin, excluded, _ = self._record(indice)
        values = tuple(record.U32.unpack_from(self._data, self._counts_offset + 4 * (start + j))[0]
                       for j in range(k))
        return record.VoceSillabica(values, record.STATI[state - 1], record.ORIGINI[origin - 1], r1)

    def compatibile(self, indice, numero_sillabe):
        record.intero(numero_sillabe, 1)
        start, k, *_ = self._record(indice)
        lo, hi = 0, k
        while lo < hi:
            mid = (lo + hi) // 2
            value = record.U32.unpack_from(self._data, self._counts_offset + 4 * (start + mid))[0]
            if value < numero_sillabe:
                lo = mid + 1
            else:
                hi = mid
        return lo < k and record.U32.unpack_from(self._data, self._counts_offset + 4 * (start + lo))[0] == numero_sillabe

    def statistiche(self):
        cardinality = Counter()
        states, origins = Counter(), Counter()
        maximum = r1_max = 0
        for i in range(self.numero_grafie):
            voce = self.voce(i)
            cardinality["0" if not voce.conteggi else "1" if len(voce.conteggi) == 1 else "piu_di_1"] += 1
            states[voce.stato] += 1
            origins[voce.origine] += 1
            maximum = max(maximum, max(voce.conteggi, default=0))
            r1_max = max(r1_max, voce.algoritmo)
        return {"parole_con_0_conteggi": cardinality["0"], "parole_con_1_conteggio": cardinality["1"],
                "parole_con_piu_conteggi": cardinality["piu_di_1"],
                "stati": {s: states[s] for s in record.STATI}, "origini": {s: origins[s] for s in record.ORIGINI},
                "conteggio_massimo_osservato": maximum, "algoritmo_massimo_osservato": r1_max}


def valida_record_pool(data, *, vocabolario_sha256=None, annotazioni_sha256=None, grafie=None, artifact_sha256=None):
    require(isinstance(data, bytes), "Buffer bytes immutabile richiesto")
    require(len(data) >= LEGACY_HEADER.size, "File troncato: header incompleto")
    magic, version, size, flags, n, m, records_at, counts_at, length, vh, ah, ph, reserved = LEGACY_HEADER.unpack_from(data)
    require(magic == LEGACY_MAGIC, "Magic errato")
    require(version == LEGACY_VERSION, "Versione runtime non supportata")
    require(size == LEGACY_HEADER.size and flags == 0 and reserved == b"\x00" * 16, "Header/valori riservati illegali")
    require(records_at == LEGACY_HEADER.size and counts_at == LEGACY_HEADER.size + LEGACY_RECORD.size * n,
            "Sezioni/offset incoerenti o fuori range")
    expected_length = counts_at + 4 * m
    require(length == expected_length and len(data) == length, "Lunghezza incoerente, file troncato o byte extra")
    if vocabolario_sha256 is not None:
        require(vh.hex() == record.hash_valido(vocabolario_sha256), "Hash vocabolario incompatibile")
    if annotazioni_sha256 is not None:
        require(ah.hex() == record.hash_valido(annotazioni_sha256), "Hash annotazioni incompatibile")
    if grafie is not None:
        record.intero(grafie)
        require(n == grafie, "Numero grafie incompatibile")
    if artifact_sha256 is not None:
        require(record.digest(data) == record.hash_valido(artifact_sha256), "SHA-256 artifact incompatibile")
    require(hashlib.sha256(memoryview(data)[LEGACY_HEADER.size:]).digest() == ph, "Checksum payload errato")
    runtime = RuntimeRecordPool(data, n, m, counts_at, vh.hex(), ah.hex())
    cursor = 0
    for i in range(n):
        start, k, _, state, origin, excluded, record_reserved = runtime._record(i)
        require(start == cursor and k <= m - start, "Offset conteggi non contiguo/fuori range")
        require(1 <= state <= len(record.STATI) and 1 <= origin <= len(record.ORIGINI), "Stato/origine illegale")
        require(excluded == int(state == record.STATE_IDS["ESCLUDI"]) and record_reserved == 0, "Valore record riservato/illegale")
        record.valida_voce(runtime.voce(i))
        cursor += k
    require(cursor == m, "Conteggi orfani o numero conteggi incoerente")
    return runtime


def crea_bitmap(voci, *, vocabolario_sha256, annotazioni_sha256):
    record.hash_valido(vocabolario_sha256)
    record.hash_valido(annotazioni_sha256)
    voci = list(voci)
    n = record.intero(len(voci))
    stride = (n + 7) // 8
    metadata, columns, populations = bytearray(), {}, {}
    m = 0
    for i, voce in enumerate(voci):
        record.valida_voce(voce)
        m = record.intero(m + len(voce.conteggi))
        metadata.extend(META.pack(voce.algoritmo, record.STATE_IDS[voce.stato],
                                  record.ORIGIN_IDS[voce.origine], 0, 0))
        for value in voce.conteggi:
            if value not in columns:
                columns[value] = bytearray(stride)
                populations[value] = 0
            columns[value][i // 8] |= 1 << (i % 8)
            populations[value] += 1
    keys = sorted(columns)
    k = record.intero(len(keys))
    directory_at = HEADER.size + META.size * n
    bitmap_at = directory_at + DIRECTORY.size * k
    directory = b"".join(DIRECTORY.pack(value, populations[value], bitmap_at + j * stride)
                         for j, value in enumerate(keys))
    payload = bytes(metadata) + directory + b"".join(columns[value] for value in keys)
    return HEADER.pack(MAGIC, VERSION, HEADER.size, 0, n, k, m, stride,
                       HEADER.size, directory_at, bitmap_at, HEADER.size + len(payload),
                       bytes.fromhex(vocabolario_sha256), bytes.fromhex(annotazioni_sha256),
                       hashlib.sha256(payload).digest(), bytes(32)) + payload


class RuntimeBitmap:
    """Buffer immutabile validato; esclusione derivata dallo stato, mai duplicata."""

    def __init__(self, data, n, m, stride, keys, offsets, vh, ah):
        self._data = data
        self.numero_grafie, self.numero_conteggi = n, m
        self._stride, self._keys, self._offsets = stride, tuple(keys), tuple(offsets)
        self.vocabolario_sha256, self.annotazioni_sha256 = vh, ah

    def _indice(self, indice):
        require(type(indice) is int and 0 <= indice < self.numero_grafie,
                "Indice parola fuori range")

    def _colonna(self, numero_sillabe):
        record.intero(numero_sillabe, 1)
        j = bisect_left(self._keys, numero_sillabe)
        return j if j < len(self._keys) and self._keys[j] == numero_sillabe else None

    def compatibile(self, indice, numero_sillabe):
        self._indice(indice)
        j = self._colonna(numero_sillabe)
        return j is not None and bool(self._data[self._offsets[j] + indice // 8] &
                                      (1 << (indice % 8)))

    def voce(self, indice):
        self._indice(indice)
        counts = tuple(value for value, offset in zip(self._keys, self._offsets)
                       if self._data[offset + indice // 8] & (1 << (indice % 8)))
        r1, state, origin, _, _ = META.unpack_from(self._data, HEADER.size + META.size * indice)
        name = record.STATI[state - 1]
        return record.VoceSillabica(counts, name, record.ORIGINI[origin - 1], r1)

    def indici_compatibili(self, numero_sillabe):
        j = self._colonna(numero_sillabe)
        if j is None:
            return
        offset = self._offsets[j]
        for byte_index in range(self._stride):
            bits = self._data[offset + byte_index]
            while bits:
                low = bits & -bits
                yield byte_index * 8 + low.bit_length() - 1
                bits ^= low


def valida_bitmap(data, *, vocabolario_sha256=None, annotazioni_sha256=None, grafie=None, artifact_sha256=None):
    require(isinstance(data, bytes), "Buffer bytes immutabile richiesto")
    require(len(data) >= HEADER.size, "Header troncato")
    magic, version, size, flags, n, k, m, stride, meta_at, directory_at, bitmap_at, length, \
        vh, ah, checksum, reserved = HEADER.unpack_from(data)
    require(magic == MAGIC and version == VERSION, "Magic/versione incompatibile")
    require(size == HEADER.size and flags == 0 and reserved == bytes(32), "Header riservato illegale")
    require(stride == (n + 7) // 8 and meta_at == HEADER.size and
            directory_at == meta_at + META.size * n and
            bitmap_at == directory_at + DIRECTORY.size * k and
            length == bitmap_at + stride * k and len(data) == length, "Offset/lunghezza incoerenti")
    require(k <= m and m <= n * k, "Numero colonne/conteggi incoerente")
    if vocabolario_sha256 is not None:
        require(vh.hex() == record.hash_valido(vocabolario_sha256), "Hash vocabolario incompatibile")
    if annotazioni_sha256 is not None:
        require(ah.hex() == record.hash_valido(annotazioni_sha256), "Hash annotazioni incompatibile")
    if grafie is not None:
        require(n == record.intero(grafie), "Numero grafie incompatibile")
    if artifact_sha256 is not None:
        require(record.digest(data) == record.hash_valido(artifact_sha256), "SHA-256 artifact incompatibile")
    require(hashlib.sha256(memoryview(data)[HEADER.size:]).digest() == checksum, "Checksum errato")
    cardinalities = array("I", [0]) * n
    require(cardinalities.itemsize == 4, "Piattaforma senza array uint32")
    keys, offsets, total = [], [], 0
    for j in range(k):
        value, population, offset = DIRECTORY.unpack_from(data, directory_at + j * DIRECTORY.size)
        require(value > (keys[-1] if keys else 0), "Conteggi nulli/duplicati/non ordinati")
        require(0 < population <= n and offset == bitmap_at + j * stride, "Directory incoerente")
        column = memoryview(data)[offset:offset + stride]
        if n % 8:
            require(column[-1] >> (n % 8) == 0, "Bit di padding non nulli")
        actual = sum(bits.bit_count() for bits in column)
        require(actual == population, "Popolazione bitmap incoerente")
        total += actual
        require(total <= m, "Conteggi eccedenti")
        for byte_index, bits in enumerate(column):
            while bits:
                low = bits & -bits
                cardinalities[byte_index * 8 + low.bit_length() - 1] += 1
                bits ^= low
        keys.append(value)
        offsets.append(offset)
    require(total == m, "Numero conteggi incoerente")
    for i, cardinality in enumerate(cardinalities):
        r1, state, origin, reserved1, reserved2 = META.unpack_from(data, meta_at + META.size * i)
        require(1 <= state <= len(record.STATI) and 1 <= origin <= len(record.ORIGINI),
                "Stato/origine illegale")
        require(reserved1 == reserved2 == 0, "Metadata riservato illegale")
        name = record.STATI[state - 1]
        # I valori reali sono positivi/distinti/ordinati per costruzione della directory.
        # Una tupla canonica di pari cardinalita' riusa la stessa politica del record.
        record.valida_voce(record.VoceSillabica(tuple(range(1, cardinality + 1)), name,
                                              record.ORIGINI[origin - 1], r1))
    return RuntimeBitmap(data, n, m, stride, keys, offsets, vh.hex(), ah.hex())


SCENARI = {"quasi_univoche": (0.95, 0.01, tuple(range(1, 9))),
           "molte_ambigue": (0.60, 0.35, tuple(range(1, 9))),
           "molte_vuote": (0.20, 0.10, tuple(range(1, 9))),
           "valori_dispersi": (0.70, 0.20, (2, 3, 7, 1000))}


def fixture(n, scenario):
    rng = random.Random(20261004)
    single, ambiguous, values = SCENARI[scenario]
    result = []
    for _ in range(n):
        p = rng.random()
        if p < single:
            state, counts = rng.choice(record.STATI[:3]), (rng.choice(values),)
        elif p < single + ambiguous:
            state, counts = "AMBIGUO", tuple(sorted(rng.sample(values, rng.choice((2, 3)))))
        else:
            state, counts = rng.choice(("CONFLITTO", "DA_RIVEDERE", "ESCLUDI")), ()
        origin = "curatela_ufficiale" if state in ("RISOLTO", "AMBIGUO", "DA_RIVEDERE", "ESCLUDI") \
            and rng.random() < 0.15 else "automatico"
        if state == "ESCLUDI":
            origin = "curatela_ufficiale"
        result.append(record.VoceSillabica(counts, state, origin, rng.choice((0,) + values)))
    return result


def misura(action, repeats):
    samples = []
    for _ in range(repeats):
        start = time.perf_counter()
        action()
        samples.append(time.perf_counter() - start)
    return statistics.median(samples) * 1000


def benchmark(n=100000, queries=20000, repeats=3):
    require(type(n) is int and n > 0 and type(queries) is int and queries > 0 and
            type(repeats) is int and repeats > 0, "Dimensioni benchmark non valide")
    reports = []
    for scenario, (_, _, values) in SCENARI.items():
        voices = fixture(n, scenario)
        rng = random.Random(741)
        pairs = [(rng.randrange(n), rng.choice(values + (record.UINT32_MAX,))) for _ in range(queries)]
        expected_hits = sum(value in voices[i].conteggi for i, value in pairs)
        expected_filter = [i for i, v in enumerate(voices) if 2 in v.conteggi]
        report = {"scenario": scenario, "N": n, "M": sum(len(v.conteggi) for v in voices),
                  "K": len({c for v in voices for c in v.conteggi}), "query": queries,
                  "ripetizioni": repeats, "risultati_filtro_2": len(expected_filter)}
        for name, writer, validator in (("record_pool", crea_record_pool, valida_record_pool),
                                        ("bitmap", record.crea_runtime, record.valida_runtime)):
            data = writer(voices, vocabolario_sha256=VH, annotazioni_sha256=AH)
            checks = dict(vocabolario_sha256=VH, annotazioni_sha256=AH, grafie=n,
                          artifact_sha256=record.digest(data))
            runtime = validator(data, **checks)
            if name == "bitmap":
                require(data == crea_bitmap(voices, vocabolario_sha256=VH, annotazioni_sha256=AH),
                        "Bitmap ufficiale diversa dal prototipo")
                prototype = valida_bitmap(data, **checks)
                require(all(prototype.voce(i) == v for i, v in enumerate(voices)),
                        "Prototipo non equivalente")
            require(runtime.annotazioni_sha256 == AH and
                    all(runtime.voce(i) == v for i, v in enumerate(voices)), "Roundtrip non equivalente")
            query_action = lambda: sum(runtime.compatibile(i, value) for i, value in pairs)
            require(query_action() == expected_hits, "Query non equivalenti")
            reconstruct = lambda: [runtime.voce(i) for i, _ in pairs]
            if name == "bitmap":
                filter_action = lambda: list(runtime.indici_compatibili(2))
            else:
                filter_action = lambda: [i for i in range(n) if runtime.compatibile(i, 2)]
            require(filter_action() == expected_filter, "Filtro non equivalente")
            copy_action = lambda: bytes(bytearray(data))
            validate_action = lambda: validator(data, **checks)
            load_action = lambda: validator(copy_action(), **checks)
            report[name] = {"raw": len(data), "byte_parola": len(data) / n,
                            "gzip_9": len(gzip.compress(data, compresslevel=9, mtime=0)),
                            "zlib_9": len(zlib.compress(data, level=9)),
                            "copia_buffer_ms": misura(copy_action, repeats),
                            "validazione_ms": misura(validate_action, repeats),
                            "caricamento_validato_ms": misura(load_action, repeats),
                            "query_ms": misura(query_action, repeats),
                            "ricostruzione_voce_us": misura(reconstruct, repeats) * 1000 / queries,
                            "filtro_tutte_2_ms": misura(filter_action, repeats)}
        reports.append(report)
    return reports


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--grafie", type=int, default=100000)
    parser.add_argument("--query", type=int, default=20000)
    parser.add_argument("--ripetizioni", type=int, default=3)
    args = parser.parse_args()
    print(json.dumps(benchmark(args.grafie, args.query, args.ripetizioni), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
