#!/usr/bin/env python3
"""Formato sillabico runtime v1: generatore offline e lettore di riferimento."""

from __future__ import annotations

import argparse
from array import array
from bisect import bisect_left
from collections import Counter
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import sys
import time

from annota_sillabe import (ANNOTAZIONI_SCHEMA_VERSION, CURATELA_SCHEMA_VERSION,
                           MANIFESTO_SCHEMA_VERSION, POLITICA_VERSION,
                           _oggetto_senza_duplicati, carica_curatela, normalizza,
                           sha256_file)


ROOT = Path(__file__).resolve().parent.parent
MAGIC = b"SILLBM\x00\x00"
VERSION = 1
HEADER = struct.Struct("<8sHHIIIIIQQQQ32s32s32s32s")
META = struct.Struct("<I4B")
DIRECTORY = struct.Struct("<IIQ")
U32 = struct.Struct("<I")
UINT32_MAX = 0xffffffff
UINT64_MAX = 0xffffffffffffffff
MAX_JSON_BYTES = 16 * 1024 * 1024
FORMAT = "sillabe-bitmap-le-v1"
STATI = ("RISOLTO", "STIMA_CORROBORATA", "SOLO_STIMA", "CONFLITTO",
         "DA_RIVEDERE", "AMBIGUO", "ESCLUDI")
ORIGINI = ("automatico", "curatela_ufficiale")
STATE_IDS = {name: i + 1 for i, name in enumerate(STATI)}
ORIGIN_IDS = {name: i + 1 for i, name in enumerate(ORIGINI)}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def hash_valido(value):
    require(isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value), "SHA-256 non valido")
    return value


def intero(value, minimum=0):
    require(type(value) is int and minimum <= value <= UINT32_MAX, "Intero uint32 fuori range/non valido")
    return value


def json_bytes(data):
    def non_finito(value):
        raise ValueError("Numero JSON non finito: " + value)
    return json.loads(data.decode("utf-8"), object_pairs_hook=_oggetto_senza_duplicati,
                      parse_constant=non_finito)


def serializza(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode("utf-8")


@dataclass(frozen=True)
class VoceSillabica:
    conteggi: tuple[int, ...]
    stato: str
    origine: str = "automatico"
    algoritmo: int = 0

    @property
    def esclusione_in_attesa(self):
        return self.stato == "ESCLUDI"


def valida_voce(voce):
    require(isinstance(voce, VoceSillabica), "Voce sillabica richiesta")
    require(isinstance(voce.conteggi, tuple), "Conteggi come tupla richiesti")
    previous = 0
    for n in voce.conteggi:
        intero(n, 1)
        require(n > previous, "Conteggi non ordinati o duplicati")
        previous = n
    require(isinstance(voce.stato, str) and voce.stato in STATE_IDS, "Stato non valido")
    require(isinstance(voce.origine, str) and voce.origine in ORIGIN_IDS, "Origine non valida")
    intero(voce.algoritmo)
    k = len(voce.conteggi)
    require((k == 1 if voce.stato in STATI[:3] else k >= 2 if voce.stato == "AMBIGUO" else k == 0),
            "Cardinalita' dei conteggi incompatibile con lo stato")
    if voce.origine == "curatela_ufficiale":
        require(voce.stato in ("RISOLTO", "AMBIGUO", "DA_RIVEDERE", "ESCLUDI"),
                "Stato incompatibile con la curatela ufficiale schema 1")


def uint64(value):
    require(type(value) is int and 0 <= value <= UINT64_MAX, "Overflow/intero uint64 non valido")
    return value


def layout(n, k):
    intero(n)
    intero(k)
    stride = (n + 7) // 8
    directory_at = uint64(HEADER.size + uint64(META.size * n))
    bitmap_at = uint64(directory_at + uint64(DIRECTORY.size * k))
    length = uint64(bitmap_at + uint64(stride * k))
    return stride, directory_at, bitmap_at, length


def crea_runtime(voci, *, vocabolario_sha256, annotazioni_sha256):
    hash_valido(vocabolario_sha256)
    hash_valido(annotazioni_sha256)
    voci = list(voci)
    n = intero(len(voci))
    stride = (n + 7) // 8
    metadata, columns, populations = bytearray(), {}, {}
    m = 0
    for i, voce in enumerate(voci):
        valida_voce(voce)
        m = intero(m + len(voce.conteggi))
        metadata.extend(META.pack(voce.algoritmo, STATE_IDS[voce.stato],
                                  ORIGIN_IDS[voce.origine], 0, 0))
        for value in voce.conteggi:
            if value not in columns:
                columns[value] = bytearray(stride)
                populations[value] = 0
            columns[value][i // 8] |= 1 << (i % 8)
            populations[value] += 1
    keys = sorted(columns)
    k = intero(len(keys))
    stride, directory_at, bitmap_at, length = layout(n, k)
    directory = b"".join(DIRECTORY.pack(value, populations[value], bitmap_at + j * stride)
                         for j, value in enumerate(keys))
    payload = bytes(metadata) + directory + b"".join(columns[value] for value in keys)
    require(length == HEADER.size + len(payload), "Lunghezza generata incoerente")
    return HEADER.pack(MAGIC, VERSION, HEADER.size, 0, n, k, m, stride,
                       HEADER.size, directory_at, bitmap_at, length,
                       bytes.fromhex(vocabolario_sha256), bytes.fromhex(annotazioni_sha256),
                       hashlib.sha256(payload).digest(), bytes(32)) + payload


class RuntimeSillabe:
    """Snapshot immutabile: chiave primaria indice zero-based, nessuna parola memorizzata."""

    def __init__(self, data, n, m, stride, keys, offsets, vocab_hash, annotations_hash):
        self._data = data
        self.numero_grafie = n
        self.numero_conteggi = m  # Membership totali, non il numero di colonne.
        self.numero_conteggi_distinti = len(keys)
        self.bitmap_stride = stride
        self._stride, self._keys, self._offsets = stride, tuple(keys), tuple(offsets)
        self.vocabolario_sha256, self.annotazioni_sha256 = vocab_hash, annotations_hash

    def _indice(self, indice):
        require(type(indice) is int and 0 <= indice < self.numero_grafie, "Indice parola fuori range")

    def _colonna(self, numero_sillabe):
        intero(numero_sillabe, 1)
        j = bisect_left(self._keys, numero_sillabe)
        return j if j < len(self._keys) and self._keys[j] == numero_sillabe else None

    def voce(self, indice):
        self._indice(indice)
        values = tuple(value for value, offset in zip(self._keys, self._offsets)
                       if self._data[offset + indice // 8] & (1 << (indice % 8)))
        r1, state, origin, _, _ = META.unpack_from(self._data, HEADER.size + META.size * indice)
        return VoceSillabica(values, STATI[state - 1], ORIGINI[origin - 1], r1)

    def compatibile(self, indice, numero_sillabe):
        self._indice(indice)
        j = self._colonna(numero_sillabe)
        return j is not None and bool(self._data[self._offsets[j] + indice // 8] &
                                      (1 << (indice % 8)))

    def indici_compatibili(self, numero_sillabe):
        # Valida subito il parametro, anche prima di consumare l'iteratore.
        j = self._colonna(numero_sillabe)
        return iter(()) if j is None else self._indici_colonna(self._offsets[j])

    def _indici_colonna(self, offset):
        for byte_index in range(self.bitmap_stride):
            bits = self._data[offset + byte_index]
            while bits:
                low = bits & -bits
                yield byte_index * 8 + low.bit_length() - 1
                bits ^= low

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
                "stati": {s: states[s] for s in STATI}, "origini": {s: origins[s] for s in ORIGINI},
                "conteggio_massimo_osservato": maximum, "algoritmo_massimo_osservato": r1_max}


def valida_runtime(data, *, vocabolario_sha256=None, annotazioni_sha256=None, grafie=None,
                   artifact_sha256=None):
    require(isinstance(data, bytes), "Buffer bytes immutabile richiesto")
    require(len(data) >= HEADER.size, "File troncato: header incompleto")
    magic, version, size, flags, n, k, m, stride, meta_at, directory_at, bitmap_at, length, \
        vh, ah, checksum, reserved = HEADER.unpack_from(data)
    require(magic == MAGIC, "Magic errato")
    require(version == VERSION, "Versione runtime non supportata")
    require(size == HEADER.size and flags == 0 and reserved == bytes(32), "Header/riservati illegali")
    expected_stride, expected_directory, expected_bitmap, expected_length = layout(n, k)
    require(stride == expected_stride and meta_at == HEADER.size and
            directory_at == expected_directory and bitmap_at == expected_bitmap,
            "Sezioni/offset/stride incoerenti o fuori range")
    require(length == expected_length and len(data) == length,
            "Lunghezza incoerente, file troncato o byte extra")
    require(k <= m and m <= n * k, "Numero colonne/membership incoerente")
    if vocabolario_sha256 is not None:
        require(vh.hex() == hash_valido(vocabolario_sha256), "Hash vocabolario incompatibile")
    if annotazioni_sha256 is not None:
        require(ah.hex() == hash_valido(annotazioni_sha256), "Hash annotazioni incompatibile")
    if grafie is not None:
        require(n == intero(grafie), "Numero grafie incompatibile")
    if artifact_sha256 is not None:
        require(digest(data) == hash_valido(artifact_sha256), "SHA-256 artifact incompatibile")
    require(hashlib.sha256(memoryview(data)[HEADER.size:]).digest() == checksum, "Checksum payload errato")
    cardinalities = array("I", [0]) * n
    require(cardinalities.itemsize == 4, "Piattaforma senza array uint32")
    keys, offsets, total = [], [], 0
    for j in range(k):
        value, population, offset = DIRECTORY.unpack_from(data, directory_at + DIRECTORY.size * j)
        require(value > (keys[-1] if keys else 0), "Conteggi nulli/duplicati/non ordinati")
        require(0 < population <= n and offset == bitmap_at + j * stride,
                "Popolazione/offset directory non canonico")
        column = memoryview(data)[offset:offset + stride]
        if n % 8:
            require(column[-1] >> (n % 8) == 0, "Bit di padding non nulli")
        actual = sum(bits.bit_count() for bits in column)
        require(actual == population, "Popolazione dichiarata diversa dal popcount")
        total += actual
        require(total <= m, "Membership eccedenti")
        for byte_index, bits in enumerate(column):
            while bits:
                low = bits & -bits
                cardinalities[byte_index * 8 + low.bit_length() - 1] += 1
                bits ^= low
        keys.append(value)
        offsets.append(offset)
    require(total == m, "Numero membership incoerente")
    for i, cardinality in enumerate(cardinalities):
        r1, state, origin, reserved1, reserved2 = META.unpack_from(data, meta_at + META.size * i)
        require(1 <= state <= len(STATI) and 1 <= origin <= len(ORIGINI), "Stato/origine illegale")
        require(reserved1 == reserved2 == 0, "Metadata riservato illegale")
        # La directory ha gia' provato positivita'/unicita' dei valori reali.
        # Questa tupla di pari cardinalita' riusa la semantica upstream per parola.
        valida_voce(VoceSillabica(tuple(range(1, cardinality + 1)), STATI[state - 1],
                                 ORIGINI[origin - 1], r1))
    # L'array O(N) rimane locale: il runtime conserva soltanto buffer e indice O(K).
    return RuntimeSillabe(data, n, m, stride, keys, offsets, vh.hex(), ah.hex())


def leggi_runtime(path, **verifiche):
    return valida_runtime(Path(path).read_bytes(), **verifiche)


def leggi_vocabolario(path):
    # Come la pipeline: conserva le righe, non normalizza/ordina gli input. Ammette N=0.
    words = path.read_text(encoding="utf-8-sig").splitlines()
    seen = set()
    for word in words:
        require(bool(word) and normalizza(word) == word and not any(c.isspace() for c in word),
                "Grafia vocabolario non canonica")
        require(word not in seen, "Grafia vocabolario duplicata")
        seen.add(word)
    intero(len(words))
    return words


class _CuratelaInMemoria:
    def __init__(self, word, decision):
        self.text = serializza({"schema_version": CURATELA_SCHEMA_VERSION,
                                "tipo": "curatela_ufficiale", "decisioni": {word: decision}}).decode("utf-8")

    def read_text(self, *, encoding):
        return self.text


def voce_da_record(record):
    require(isinstance(record, dict) and type(record.get("schema_version")) is int and
            record["schema_version"] == ANNOTAZIONI_SCHEMA_VERSION and
            record.get("politica_version") == POLITICA_VERSION, "Schema/politica annotazioni incompatibile")
    require(isinstance(record.get("conteggi"), list), "Lista conteggi richiesta")
    voce = VoceSillabica(tuple(record["conteggi"]), record.get("stato"), record.get("origine"),
                         record.get("algoritmo"))
    valida_voce(voce)
    require(type(record.get("esclusione_in_attesa")) is bool and
            record["esclusione_in_attesa"] == voce.esclusione_in_attesa, "Flag esclusione incoerente")
    auto = record.get("automatico")
    require(isinstance(auto, dict) and isinstance(auto.get("conteggi"), list), "Classificazione automatica mancante")
    automatic = VoceSillabica(tuple(auto["conteggi"]), auto.get("stato"), algoritmo=voce.algoritmo)
    valida_voce(automatic)
    if voce.origine == "automatico":
        require(voce.stato == automatic.stato and voce.conteggi == automatic.conteggi and
                "decisione_manuale" not in record and record.get("precedenza") == auto.get("precedenza") and
                isinstance(record.get("precedenza"), str), "Annotazione automatica incoerente")
    else:
        decision = record.get("decisione_manuale")
        validated = carica_curatela(_CuratelaInMemoria(record["parola"], decision))[record["parola"]]
        action = validated["azione"]
        require(voce.stato == ("RISOLTO" if action == "CONFERMA" else action) and
                voce.conteggi == tuple(validated["conteggi"]) and record.get("precedenza") == "curatela_ufficiale",
                "Decisione manuale/annotazione incoerenti")
    return voce


def leggi_annotazioni(path, words):
    count = 0
    with path.open("rb") as stream:
        while True:
            line = stream.readline(MAX_JSON_BYTES + 1)
            if not line:
                break
            require(len(line) <= MAX_JSON_BYTES, "Record JSONL oltre 16 MiB")
            record = json_bytes(line)
            require(isinstance(record, dict) and type(record.get("indice")) is int and
                    record["indice"] == count and count < len(words), "Indice/numero annotazioni incoerente")
            require(record.get("parola") == words[count], "Parola diversa dalla riga del vocabolario")
            yield voce_da_record(record)
            count += 1
    require(count == len(words), "Annotazioni mancanti rispetto al vocabolario")


def valida_manifesto_input(manifest, info, n):
    require(isinstance(manifest, dict) and type(manifest.get("schema_version")) is int and
            manifest["schema_version"] == MANIFESTO_SCHEMA_VERSION and
            manifest.get("politica_version") == POLITICA_VERSION and
            manifest.get("schemi") == {"curatela": 1, "annotazioni": 2, "manifesto": 2} and
            all(type(v) is int for v in manifest["schemi"].values()), "Manifesto pipeline v2 richiesto")
    compatibility = manifest.get("compatibilita_vocabolario")
    inputs, artifacts = manifest.get("input"), manifest.get("artefatti")
    require(isinstance(compatibility, dict) and isinstance(inputs, dict) and
            isinstance(inputs.get("vocabolario"), dict) and isinstance(artifacts, dict),
            "Sezioni del manifesto pipeline mancanti/non valide")
    require(type(compatibility.get("grafie")) is int and compatibility["grafie"] == n and
            compatibility["sha256"] == info["vocabolario"]["sha256"] and
            manifest["input"]["vocabolario"]["sha256"] == compatibility["sha256"], "Base vocabolario incompatibile")
    source = artifacts.get("annotazioni.jsonl")
    require(isinstance(source, dict), "Artefatto annotazioni assente dal manifesto")
    require(source.get("percorso") == "annotazioni.jsonl" and
            source.get("sha256") == info["annotazioni"]["sha256"] and type(source.get("byte")) is int and
            source["byte"] == info["annotazioni"]["byte"], "Hash/dimensione annotazioni incompatibili")
    declared = {}
    for name, value in inputs.items():
        require(isinstance(value, dict), "Hash sorgente non valido")
        declared[name] = hash_valido(value.get("sha256"))
    return declared


def output_esterno(path, inputs):
    original = Path(path)
    path = original.resolve()
    require(path != ROOT and ROOT not in path.parents, "Output obbligatoriamente fuori repository")
    require(path not in {p.resolve() for p in inputs}, "Output coincide con un input")
    require(not original.is_symlink() and not path.exists(), "Output gia' esistente: non sovrascrivo")
    require(path.parent.is_dir(), "La cartella esterna di output deve gia' esistere")
    return path


def genera(vocabolario, annotazioni, manifesto_input, artifact, manifesto_output):
    paths = {"vocabolario": Path(vocabolario).resolve(), "annotazioni": Path(annotazioni).resolve(),
             "manifesto_pipeline": Path(manifesto_input).resolve()}
    artifact = output_esterno(artifact, paths.values())
    output = output_esterno(manifesto_output, paths.values())
    require(artifact != output, "Artifact e manifest devono essere distinti")
    info = {name: {"sha256": sha256_file(p), "byte": p.stat().st_size} for name, p in paths.items()}
    require(paths["manifesto_pipeline"].stat().st_size <= MAX_JSON_BYTES, "Manifesto troppo grande")
    manifest = json_bytes(paths["manifesto_pipeline"].read_bytes())
    words = leggi_vocabolario(paths["vocabolario"])
    source_hashes = valida_manifesto_input(manifest, info, len(words))
    data = crea_runtime(leggi_annotazioni(paths["annotazioni"], words),
                        vocabolario_sha256=info["vocabolario"]["sha256"],
                        annotazioni_sha256=info["annotazioni"]["sha256"])
    runtime = valida_runtime(data, vocabolario_sha256=info["vocabolario"]["sha256"],
                             annotazioni_sha256=info["annotazioni"]["sha256"], grafie=len(words))
    result = {"schema_version": 1, "tipo": "manifesto_runtime_sillabe", "formato": FORMAT,
              "runtime_version": VERSION, "endianess": "little", "numero_grafie": len(words),
              "numero_conteggi": runtime.numero_conteggi, "vocabolario_sha256": runtime.vocabolario_sha256,
              "numero_conteggi_distinti": runtime.numero_conteggi_distinti,
              "bitmap_stride": runtime.bitmap_stride,
              "annotazioni_schema_version": ANNOTAZIONI_SCHEMA_VERSION,
              "annotazioni_sha256": runtime.annotazioni_sha256,
              "manifesto_pipeline_sha256": info["manifesto_pipeline"]["sha256"],
              "hash_sorgenti_dichiarati": source_hashes, "politica_pipeline": POLITICA_VERSION,
              "configurazione": {"conteggi": "effettivi_della_pipeline", "selezione_stati": "nessuna",
                                 "fallback_algoritmo": False, "esclusioni_dataset": False},
              "artifact_sha256": digest(data), "artifact_byte": len(data), "statistiche": runtime.statistiche()}
    for name, path in paths.items():
        require(sha256_file(path) == info[name]["sha256"] and path.stat().st_size == info[name]["byte"],
                "Input cambiato durante la generazione: " + name)
    created, streams = [], []
    try:
        for path in (artifact, output):
            streams.append(path.open("xb"))
            created.append(path)
        streams[0].write(data)
        streams[1].write(serializza(result))
        for stream in streams:
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        for stream in streams:
            stream.close()
        for path in created:
            path.unlink()
        raise
    finally:
        for stream in streams:
            stream.close()
    return result


def verifica_artifact(artifact, manifesto, *, vocabolario=None):
    manifest = json_bytes(Path(manifesto).read_bytes())
    require(isinstance(manifest, dict) and type(manifest.get("schema_version")) is int and
            manifest["schema_version"] == 1 and manifest.get("tipo") == "manifesto_runtime_sillabe" and
            manifest.get("formato") == FORMAT and type(manifest.get("runtime_version")) is int and
            manifest["runtime_version"] == VERSION and manifest.get("endianess") == "little",
            "Manifest runtime non supportato")
    hash_valido(manifest.get("manifesto_pipeline_sha256"))
    require(type(manifest.get("annotazioni_schema_version")) is int and
            manifest["annotazioni_schema_version"] == ANNOTAZIONI_SCHEMA_VERSION and
            manifest.get("politica_pipeline") == POLITICA_VERSION and
            serializza(manifest.get("configurazione")) == serializza({
                "conteggi": "effettivi_della_pipeline", "selezione_stati": "nessuna",
                "fallback_algoritmo": False, "esclusioni_dataset": False}), "Politica runtime incoerente")
    require(isinstance(manifest.get("hash_sorgenti_dichiarati"), dict), "Hash sorgenti mancanti")
    for value in manifest["hash_sorgenti_dichiarati"].values():
        hash_valido(value)
    runtime = leggi_runtime(artifact, vocabolario_sha256=manifest["vocabolario_sha256"],
                           annotazioni_sha256=manifest["annotazioni_sha256"],
                           grafie=manifest["numero_grafie"], artifact_sha256=manifest["artifact_sha256"])
    require(type(manifest.get("artifact_byte")) is int and Path(artifact).stat().st_size == manifest["artifact_byte"] and
            type(manifest.get("numero_conteggi")) is int and runtime.numero_conteggi == manifest["numero_conteggi"] and
            type(manifest.get("numero_conteggi_distinti")) is int and
            runtime.numero_conteggi_distinti == manifest["numero_conteggi_distinti"] and
            type(manifest.get("bitmap_stride")) is int and runtime.bitmap_stride == manifest["bitmap_stride"] and
            runtime.annotazioni_sha256 == manifest["annotazioni_sha256"] and
            serializza(runtime.statistiche()) == serializza(manifest["statistiche"]), "Manifest runtime incoerente")
    if vocabolario is not None:
        path = Path(vocabolario)
        require(sha256_file(path) == runtime.vocabolario_sha256 and
                len(leggi_vocabolario(path)) == runtime.numero_grafie, "Vocabolario incompatibile")
    return runtime


def pubblica_web(artifact, manifesto, vocabolario, output):
    paths = {"artifact": Path(artifact).resolve(), "manifesto": Path(manifesto).resolve(),
             "vocabolario": Path(vocabolario).resolve()}
    output = output_esterno(output, paths.values())
    info = {name: (sha256_file(path), path.stat().st_size) for name, path in paths.items()}
    runtime = verifica_artifact(paths["artifact"], paths["manifesto"], vocabolario=paths["vocabolario"])
    require(runtime.numero_grafie > 0, "Pubblicazione web: vocabolario vuoto non supportato")
    # Copia il buffer immutabile realmente validato, non una seconda lettura della sorgente.
    data = runtime._data
    sha = digest(data)
    require((sha, len(data)) == info["artifact"], "Input cambiato durante la pubblicazione: artifact")
    result = {"schema": 1, "disponibile": True, "formato": FORMAT,
              "artifact": f"runtime-sillabe-{sha}.bin", "artifact_sha256": sha,
              "vocabolario_sha256": runtime.vocabolario_sha256,
              "annotazioni_sha256": runtime.annotazioni_sha256,
              "numero_grafie": runtime.numero_grafie, "dimensione_byte": len(data)}

    def controlla_input():
        for name, path in paths.items():
            require((sha256_file(path), path.stat().st_size) == info[name],
                    "Input cambiato durante la pubblicazione: " + name)

    controlla_input()
    output.mkdir()  # Prenotazione esclusiva: nessun overwrite, anche in caso di race.
    created = []
    try:
        for path, content in ((output / result["artifact"], data),
                              (output / "runtime-sillabe.manifest.json", serializza(result))):
            with path.open("xb") as stream:
                created.append(path)
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            if path.name == result["artifact"]:
                require(path.stat().st_size == len(data) and sha256_file(path) == sha,
                        "Copia artifact: hash/dimensione incompatibili")
            else:
                require(path.read_bytes() == content, "Scrittura manifest web incompleta")
            controlla_input()
        copied = output / result["artifact"]
        require(copied.stat().st_size == len(data) and sha256_file(copied) == sha,
                "Copia artifact finale: hash/dimensione incompatibili")
    except BaseException:
        for path in reversed(created):
            path.unlink()
        output.rmdir()
        raise
    return result


def benchmark_sintetico(n=100000, queries=20000):
    """Solo bitmap ufficiale validata; confronto storico nel tool sperimentale separato."""
    intero(n, 1)
    intero(queries, 1)
    voci = []
    for i in range(n):
        state = STATI[i % len(STATI)]
        value = i % 8 + 1
        counts = (value, value + 1) if state == "AMBIGUO" else (value,) if state in STATI[:3] else ()
        origin = "curatela_ufficiale" if state == "ESCLUDI" else "automatico"
        voci.append(VoceSillabica(counts, state, origin, value))
    data = crea_runtime(voci, vocabolario_sha256="a" * 64, annotazioni_sha256="b" * 64)
    start = time.perf_counter()
    loaded = valida_runtime(data, vocabolario_sha256="a" * 64, annotazioni_sha256="b" * 64,
                            grafie=n, artifact_sha256=digest(data))
    load_ms = (time.perf_counter() - start) * 1000
    start = time.perf_counter()
    hits = sum(loaded.compatibile((j * 104729) % n, j % 10 + 1) for j in range(queries))
    query_ms = (time.perf_counter() - start) * 1000
    expected = sum((j % 10 + 1) in voci[(j * 104729) % n].conteggi for j in range(queries))
    require(hits == expected, "Benchmark: risultati query divergenti")
    return {"fixture": "sintetica_ciclo_7_stati_conteggi_1_9", "numero_grafie": n, "query": queries,
            "nota": "Python desktop, validazione completa; non prestazioni WASM",
            "rappresentazioni": {"bitmap_v1": {"byte": len(data), "byte_per_parola": len(data) / n,
                                             "caricamento_ms": load_ms, "query_ms": query_ms, "match": hits}}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="comando", required=True)
    generate = sub.add_parser("genera")
    for name in ("vocabolario", "annotazioni", "manifesto-input", "artifact", "manifesto-output"):
        generate.add_argument("--" + name, type=Path, required=True)
    verify = sub.add_parser("verifica")
    verify.add_argument("--artifact", type=Path, required=True)
    verify.add_argument("--manifesto", type=Path, required=True)
    verify.add_argument("--vocabolario", type=Path)
    publish = sub.add_parser("pubblica-web", help="Pubblica un runtime validato in un nuovo pacchetto web esterno")
    for name in ("artifact", "manifesto", "vocabolario", "output"):
        publish.add_argument("--" + name, type=Path, required=True)
    bench = sub.add_parser("benchmark")
    bench.add_argument("--grafie", type=int, default=100000)
    bench.add_argument("--query", type=int, default=20000)
    args = parser.parse_args()
    try:
        if args.comando == "genera":
            result = genera(args.vocabolario, args.annotazioni, args.manifesto_input, args.artifact, args.manifesto_output)
        elif args.comando == "verifica":
            result = verifica_artifact(args.artifact, args.manifesto, vocabolario=args.vocabolario).statistiche()
        elif args.comando == "pubblica-web":
            result = pubblica_web(args.artifact, args.manifesto, args.vocabolario, args.output)
        else:
            result = benchmark_sintetico(args.grafie, args.query)
        print(json.dumps(result, ensure_ascii=True, sort_keys=True, indent=2))
        return 0
    except (OSError, ValueError, TypeError, KeyError) as exc:
        print("Runtime rifiutato: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
