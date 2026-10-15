#!/usr/bin/env python3
"""Prepara un pacchetto locale compatto: nessuna modifica alla pipeline o curatela."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unicodedata

from annota_sillabe import carica_curatela, sha256_file, _oggetto_senza_duplicati

ROOT = Path(__file__).resolve().parent.parent
CODE = ("revisione_prioritaria", "stime_corroborate", "stime_non_verificate")
STATES = {"RISOLTO", "STIMA_CORROBORATA", "SOLO_STIMA", "CONFLITTO", "DA_RIVEDERE", "AMBIGUO", "ESCLUDI"}
SOURCES = ("wiktionary", "wiktionary_ipa", "wikipron", "phonitalia")
MAX_RECORDS = 100000
MAX_BYTES = 64 * 1024 * 1024


def require(ok, message):
    if not ok:
        raise ValueError(message)


def numeri(value, zero=False):
    require(isinstance(value, list) and len(value) <= 64 and
            all(type(n) is int and (0 if zero else 1) <= n <= 1000000 for n in value) and
            value == sorted(set(value)), "Conteggi non validi")
    return value


def testo(value, maximum=240):
    require(isinstance(value, str) and bool(value.strip()) and len(value) <= maximum,
            "Testo mancante o troppo lungo")
    return value


def grafia(word):
    testo(word, 200)
    require(word == unicodedata.normalize("NFC", word.lower().strip()) and
            not any(c.isspace() or unicodedata.category(c) == "Cc" for c in word), "Grafia non canonica")
    return word


def compatta(record, decisions, queue):
    require(isinstance(record, dict) and record.get("schema_version") == 2 and
            record.get("politica_version") == "offline-v2-evidenze", "Record non schema 2")
    word = grafia(record.get("parola"))
    require(type(record.get("indice")) is int and record["indice"] >= 0, "Indice non valido")
    require(type(record.get("algoritmo")) is int and 0 <= record["algoritmo"] <= 1000000, "R1 non valido")
    auto = record.get("automatico")
    require(isinstance(auto, dict) and auto.get("stato") in STATES, "Classificazione automatica non valida")
    require(record.get("richiede_revisione") is True and
            record.get("priorita_revisione") == ("prioritaria" if queue == "revisione_prioritaria" else queue),
            "Record non coerente con la coda")
    families = auto.get("macro_famiglie")
    require(isinstance(families, dict) and set(families) == {"wiktionary", "phonitalia"}, "Famiglie non valide")
    families = {n: numeri(v) for n, v in families.items()}
    evidence = {}
    for name in SOURCES:
        source = record.get(name)
        family = "phonitalia" if name == "phonitalia" else "wiktionary"
        require(isinstance(source, dict) and source.get("macro_famiglia") == family, "Evidenza/famiglia non valida")
        anomalies = source.get("anomalie")
        require(isinstance(anomalies, list) and len(anomalies) <= 64, "Anomalie non valide")
        small = {"conteggi": numeri(source.get("conteggi")), "anomalie": [testo(x) for x in anomalies]}
        witnesses = source.get("testimoni_sillabazioni" if name == "wiktionary" else
                               "testimoni_phonitalia" if name == "phonitalia" else "testimoni_ipa", {})
        require(isinstance(witnesses, dict) and len(witnesses) <= 64, "Testimoni non validi")
        selected = {}
        for n, value in witnesses.items():
            require(n in {str(x) for x in small["conteggi"]}, "Testimone senza conteggio")
            if name == "wiktionary":
                require(isinstance(value, list) and 0 < len(value) <= 128, "Sillabazione non valida")
                selected[n] = [testo(part, 200) for part in value]
            elif name == "phonitalia":
                require(isinstance(value, dict), "PhoneSyll non valido")
                selected[n] = {"phone_syll": testo(value.get("phone_syll"), 240)}
                stress = value.get("sillaba_tonica")
                require(type(stress) is int and stress >= 0, "Accento PhonItalia non valido")
                selected[n]["sillaba_tonica"] = stress
            else:
                # Un testimone completo troppo lungo resta rintracciabile nel raw sul PC.
                selected[n] = testo(value, 10000)[:240]
        small["testimoni"] = selected
        examples = source.get("testimoni_anomalie", {})
        require(isinstance(examples, dict) and len(examples) <= 64, "Testimoni anomalie non validi")
        small["esempi_anomalie"] = {testo(n): testo(v.get("ipa"), 10000)[:240]
                                    for n, v in examples.items() if isinstance(v, dict) and v.get("ipa")}
        evidence[name] = small
    union = sorted(set().union(*(set(evidence[n]["conteggi"]) for n in SOURCES[:3])))
    require(families["wiktionary"] == union and families["phonitalia"] == evidence["phonitalia"]["conteggi"],
            "Famiglie non coerenti con le evidenze")
    require(numeri(auto.get("candidati_lessicali")) == sorted(set(union) | set(families["phonitalia"])),
            "Candidati non coerenti con le evidenze")
    return {"parola": word, "indice": record["indice"], "r1": record["algoritmo"],
            "stato_automatico": auto["stato"], "motivo": testo(auto.get("motivo")),
            "candidati": numeri(auto.get("candidati_lessicali")), "macro_famiglie": families,
            "evidenze": evidence, "decisione_base": decisions.get(word),
            "priorita": record["priorita_revisione"]}


def revisione_git(curatela):
    relative = curatela.resolve().relative_to(ROOT).as_posix()
    options = dict(cwd=ROOT, capture_output=True, check=True, env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"})
    head = subprocess.run(["git", "rev-parse", "HEAD"], **options).stdout.decode().strip()
    stored = subprocess.run(["git", "show", head + ":" + relative], **options).stdout
    require(hashlib.sha256(stored).hexdigest() == sha256_file(curatela),
            "Curatela diversa dalla versione Git: indicare --senza-git, senza fingere una revisione verificata")
    return head


def prepara(manifesto, curatela, output, *, coda="revisione_prioritaria", offset=0, limite=None, git_base=None):
    require(coda in CODE, "Coda sconosciuta")
    require(type(offset) is int and offset >= 0 and
            (limite is None or type(limite) is int and 1 <= limite <= MAX_RECORDS), "Intervallo non valido")
    output = output.resolve()
    require(output != ROOT and ROOT not in output.parents, "Output obbligatoriamente fuori repository")
    require(not output.exists(), "Output gia' esistente: non sovrascrivo")
    require(git_base is None or re.fullmatch(r"[a-f0-9]{40}|[a-f0-9]{64}", git_base), "Revisione Git non valida")
    manifest_hash = sha256_file(manifesto)
    m = json.loads(manifesto.read_text(encoding="utf-8"), object_pairs_hook=_oggetto_senza_duplicati)
    require(type(m.get("schema_version")) is int and m.get("schema_version") == 2 and m.get("politica_version") == "offline-v2-evidenze" and
            m.get("schemi") == {"curatela": 1, "annotazioni": 2, "manifesto": 2}, "Manifesto v2 richiesto")
    require(all(type(n) is int for n in m["schemi"].values()), "Versioni schema non numeriche")
    require(m["input"]["curatela"]["sha256"] == sha256_file(curatela), "Curatela non allineata al manifesto")
    decisions = carica_curatela(curatela)
    vocab = m["compatibilita_vocabolario"]
    require(type(vocab.get("grafie")) is int and vocab["grafie"] > 0 and
            re.fullmatch("[a-f0-9]{64}", vocab.get("sha256", "")) and
            vocab["sha256"] == m["input"]["vocabolario"]["sha256"], "Base vocabolario non valida")
    filename = coda + ".jsonl"
    info = m["artefatti"][filename]
    require(info.get("percorso") == filename, "Percorso coda non locale al manifesto")
    queue = manifesto.parent / filename
    require(sha256_file(queue) == info["sha256"] and queue.stat().st_size == info["byte"], "Hash/dimensione coda diversi")
    words, records, previous, total = set(), [], -1, 0
    with queue.open(encoding="utf-8") as stream:
        for line in stream:
            record = compatta(json.loads(line, object_pairs_hook=_oggetto_senza_duplicati), decisions, coda)
            require(record["parola"] not in words, "Parola duplicata nella coda")
            require(previous < record["indice"] < vocab["grafie"], "Ordine/indice coda non valido")
            words.add(record["parola"])
            previous = record["indice"]
            if total >= offset and (limite is None or len(records) < limite):
                records.append(record)
                require(len(records) <= MAX_RECORDS, "Coda troppo grande: usare --offset e --limite")
            total += 1
    require(records, "Pacchetto senza record")
    base = {"vocabolario_sha256": vocab["sha256"], "grafie": vocab["grafie"],
            "curatela_schema_version": 1, "curatela_sha256": m["input"]["curatela"]["sha256"],
            "curatela_revisione_git_base": git_base, "annotazioni_schema_version": 2,
            "politica_version": m["politica_version"], "manifesto_sha256": manifest_hash}
    package = {"schema_version": 1, "tipo": "pacchetto_revisione_sillabe",
               "creato_utc": datetime.now(timezone.utc).isoformat(), "coda": coda, "base": base,
               "intervallo": {"offset": offset, "record_coda": total}, "record": records,
               "note_licenza": "Artefatto locale. Dati Wiktionary/WikiPron non Apache 2; PhonItalia CC BY4.0. Redistribuzione da verificare separatamente."}
    data = (json.dumps(package, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    require(len(data) <= MAX_BYTES, "Pacchetto oltre 64 MiB: usare --limite")
    require(sha256_file(manifesto) == manifest_hash and sha256_file(curatela) == base["curatela_sha256"] and
            sha256_file(queue) == info["sha256"], "Input cambiati durante il packaging")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent, delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(data)
    try:
        # Exclusive creation prevents an accidental replacement in a concurrent run.
        with output.open("xb") as destination, temporary.open("rb") as source:
            import shutil
            shutil.copyfileobj(source, destination)
    finally:
        temporary.unlink()
    return {"percorso": str(output), "record": len(records), "byte": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifesto", type=Path, required=True)
    p.add_argument("--curatela", type=Path, default=ROOT / "tools/sillabe/curatela_ufficiale.json")
    p.add_argument("--coda", choices=CODE, default=CODE[0])
    p.add_argument("--offset", type=int, default=0)
    p.add_argument("--limite", type=int)
    p.add_argument("--senza-git", action="store_true", help="Base Git nulla: il futuro merge richiedera' controllo esplicito")
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    try:
        result = prepara(args.manifesto, args.curatela, args.output, coda=args.coda,
                         offset=args.offset, limite=args.limite,
                         git_base=None if args.senza_git else revisione_git(args.curatela))
        print(json.dumps(result, ensure_ascii=True, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as exc:
        print("Packaging rifiutato: " + str(exc))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
