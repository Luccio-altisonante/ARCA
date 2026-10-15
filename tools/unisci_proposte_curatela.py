#!/usr/bin/env python3
"""Analizza un export; genera solo su richiesta una curatela candidata esterna."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from annota_sillabe import (ANNOTAZIONI_SCHEMA_VERSION, CURATELA_SCHEMA_VERSION,
                           POLITICA_VERSION, _oggetto_senza_duplicati,
                           carica_curatela, leggi_vocabolario)
from prepara_revisione_mobile import grafia, numeri, testo


ROOT = Path(__file__).resolve().parent.parent
CURATELA_GIT = "tools/sillabe/curatela_ufficiale.json"
MAX_BYTES = 64 * 1024 * 1024
BASE_KEYS = {"vocabolario_sha256", "grafie", "curatela_schema_version", "curatela_sha256",
             "curatela_revisione_git_base", "annotazioni_schema_version", "politica_version",
             "manifesto_sha256"}
DECISION_KEYS = {"azione", "conteggi", "autore", "data", "motivazione"}
CATEGORIE = ("APPLICABILE", "IDEMPOTENTE", "CONFLITTO", "BASE_INCOMPATIBILE",
             "PAROLA_NON_VALIDA", "RICHIEDE_CONTROLLO", "RICHIEDE_CONTROLLO_STORICO")


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def serializza(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode("utf-8")


def leggi_bytes(path):
    with path.open("rb") as stream:
        data = stream.read(MAX_BYTES + 1)
    require(len(data) <= MAX_BYTES, "Input oltre 64 MiB")
    return data


def json_bytes(data):
    def non_finito(value):
        raise ValueError(f"Numero JSON non finito: {value}")
    return json.loads(data.decode("utf-8"), object_pairs_hook=_oggetto_senza_duplicati,
                      parse_constant=non_finito)


def campi(value, expected, message):
    require(isinstance(value, dict) and set(value) == expected, message)


class _CuratelaInMemoria:
    """Adatta uno snapshot al validatore esistente senza file temporanei/refactor."""

    def __init__(self, value):
        self.text = serializza(value).decode("utf-8")

    def read_text(self, *, encoding):
        return self.text


def valida_curatela(value):
    campi(value, {"schema_version", "tipo", "decisioni"}, "Campi curatela incompatibili")
    require(isinstance(value["decisioni"], dict), "Decisioni curatela non valide")
    for word, decision in value["decisioni"].items():
        grafia(word)
        campi(decision, DECISION_KEYS, "Campi decisione ufficiale incompatibili")
    # Fonte autorevole per azioni, cardinalita', booleani, data e normalizzazione.
    return carica_curatela(_CuratelaInMemoria(value))


def valida_decisione(word, decision):
    campi(decision, DECISION_KEYS, "Campi decisione incompatibili")
    numeri(decision["conteggi"])
    testo(decision["autore"], 200)
    testo(decision["data"], 64)
    testo(decision["motivazione"], 2000)
    valida_curatela({"schema_version": CURATELA_SCHEMA_VERSION,
                     "tipo": "curatela_ufficiale", "decisioni": {word: decision}})


def valida_base(base):
    campi(base, BASE_KEYS, "Base incompleta o campi incompatibili")
    for key in ("vocabolario_sha256", "curatela_sha256", "manifesto_sha256"):
        require(isinstance(base[key], str) and re.fullmatch(r"[a-f0-9]{64}", base[key]),
                f"SHA-256 non valido: {key}")
    require(type(base["grafie"]) is int and base["grafie"] > 0, "Numero grafie non valido")
    require(type(base["curatela_schema_version"]) is int and
            base["curatela_schema_version"] == CURATELA_SCHEMA_VERSION and
            type(base["annotazioni_schema_version"]) is int and
            base["annotazioni_schema_version"] == ANNOTAZIONI_SCHEMA_VERSION and
            base["politica_version"] == POLITICA_VERSION, "Versioni di base incompatibili")
    revision = base["curatela_revisione_git_base"]
    require(revision is None or isinstance(revision, str) and
            re.fullmatch(r"[a-f0-9]{40}|[a-f0-9]{64}", revision), "Revisione Git non valida")


class Git:
    def __init__(self, repository):
        self.repository = repository.resolve()
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        self.env.update(GIT_OPTIONAL_LOCKS="0", GIT_NO_REPLACE_OBJECTS="1")

    def run(self, *args):
        result = subprocess.run(["git", "-C", str(self.repository), *args],
                                capture_output=True, env=self.env, timeout=60)
        require(result.returncode == 0, "Verifica Git fallita: " + " ".join(args))
        return result.stdout

    def head(self):
        return self.run("rev-parse", "--verify", "HEAD^{commit}").decode().strip()

    def curatela(self, commit):
        raw = self.run("show", commit + ":" + CURATELA_GIT)
        require(len(raw) <= MAX_BYTES, "Curatela Git oltre 64 MiB")
        return raw, valida_curatela(json_bytes(raw))


def verifica_git(repository, base, words):
    git = Git(repository)
    info = {"head": None, "base_verificata": False, "storico_verificato": False,
            "problemi_base": [], "problemi_storico": [], "parole_modificate": [],
            "commit_modifiche": {}}
    base_decisions = None
    try:
        info["head"] = git.head()
        revision = base["curatela_revisione_git_base"]
        if revision is None:
            info["problemi_storico"].append("Revisione di base assente: ABA non verificabile")
            return info, None
        resolved = git.run("rev-parse", "--verify", revision + "^{commit}").decode().strip()
        require(resolved == revision, "La base deve identificare esattamente un commit")
        git.run("merge-base", "--is-ancestor", revision, info["head"])
        raw, base_decisions = git.curatela(revision)
        require(sha(raw) == base["curatela_sha256"], "Hash curatela al commit base diverso")
        info["base_verificata"] = True
    except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
        info["problemi_base"].append(str(exc))
        return info, None
    try:
        require(git.run("rev-parse", "--is-shallow-repository").strip() == b"false",
                "Repository shallow: storico non completo")
        require(not git.run("for-each-ref", "--format=%(refname)", "refs/replace").strip(),
                "Git replace presente: storico da controllare")
        graft = Path(git.run("rev-parse", "--git-path", "info/grafts").decode().strip())
        if not graft.is_absolute():
            graft = git.repository / graft
        require(not graft.exists() or graft.stat().st_size == 0, "Git grafts presenti")
        cache = {revision: base_decisions}

        def snapshot(commit):
            if commit not in cache:
                cache[commit] = git.curatela(commit)[1]
            return cache[commit]

        # Nessun path-limited log: confronta ogni arco, inclusi i genitori dei merge.
        history = git.run("rev-list", "--parents", revision + ".." + info["head"])
        changed = {}
        for line in history.decode().splitlines():
            commit, *parents = line.split()
            current = snapshot(commit)
            for parent in parents:
                previous = snapshot(parent)
                for word in words:
                    if current.get(word) != previous.get(word):
                        changed.setdefault(word, set()).add(commit)
        info["commit_modifiche"] = {w: sorted(v) for w, v in sorted(changed.items())}
        info["parole_modificate"] = sorted(changed)
        info["storico_verificato"] = True
    except (ValueError, OSError, subprocess.TimeoutExpired) as exc:
        info["problemi_storico"].append(str(exc))
    return info, base_decisions


def analizza(proposte, curatela, *, repository=ROOT, vocabolario=None, manifesto=None):
    """Non scrive nulla. Input espliciti: nessun accesso implicito a backup reali."""
    paths = [Path(proposte).resolve(), Path(curatela).resolve()]
    if vocabolario is not None:
        paths.append(Path(vocabolario).resolve())
    if manifesto is not None:
        paths.append(Path(manifesto).resolve())
    snapshots = {p: leggi_bytes(p) for p in paths}
    p = json_bytes(snapshots[paths[0]])
    current_doc = json_bytes(snapshots[paths[1]])
    current = valida_curatela(current_doc)
    campi(p, {"schema_version", "tipo", "sessione_id", "base", "decisioni"},
          "Campi proposte incompatibili")
    require(type(p["schema_version"]) is int and p["schema_version"] == 1 and
            p["tipo"] == "proposte_curatela_ufficiale", "Schema/tipo proposte incompatibile")
    testo(p["sessione_id"], 200)
    require(isinstance(p["decisioni"], list) and len(p["decisioni"]) <= 100000,
            "Numero decisioni non valido")
    seen, prepared = set(), []
    for d in p["decisioni"]:
        campi(d, DECISION_KEYS | {"parola", "decisione_base"}, "Campi proposta incompatibili")
        word = d["parola"]
        require(isinstance(word, str), "Parola non testuale")
        require(word not in seen, "Parola duplicata nelle proposte: " + word)
        seen.add(word)
        row = {"parola": word, "proposta": {k: d[k] for k in DECISION_KEYS},
               "decisione_base": d["decisione_base"], "corrente": current.get(word)}
        try:
            grafia(word)
        except ValueError as exc:
            row.update(categoria="PAROLA_NON_VALIDA", motivo=str(exc))
        if "categoria" not in row:
            try:
                valida_decisione(word, row["proposta"])
                if row["decisione_base"] is not None:
                    valida_decisione(word, row["decisione_base"])
            except (ValueError, TypeError) as exc:
                row.update(categoria="RICHIEDE_CONTROLLO", motivo=str(exc))
        prepared.append(row)
    problems, controls, checks = [], [], {}
    git_info = {"head": None, "base_verificata": False, "storico_verificato": False,
                "problemi_base": [], "problemi_storico": [], "parole_modificate": [],
                "commit_modifiche": {}}
    base_decisions = None
    try:
        valida_base(p["base"])
    except ValueError as exc:
        problems.append(str(exc))
    if not problems:
        base = p["base"]
        if vocabolario is None:
            controls.append("Vocabolario non fornito: hash, grafie e appartenenza non verificabili")
            checks["vocabolario"] = "non_verificato"
        else:
            vocab_path = Path(vocabolario).resolve()
            vocab_words = set(leggi_vocabolario(vocab_path))
            require(leggi_bytes(vocab_path) == snapshots[vocab_path], "Vocabolario cambiato durante la lettura")
            checks["vocabolario"] = {"sha256": sha(snapshots[vocab_path]), "grafie": len(vocab_words)}
            if checks["vocabolario"]["sha256"] != base["vocabolario_sha256"] or len(vocab_words) != base["grafie"]:
                problems.append("Hash/numero grafie del vocabolario incompatibili")
            for row in prepared:
                if "categoria" not in row and row["parola"] not in vocab_words:
                    row.update(categoria="PAROLA_NON_VALIDA", motivo="Parola assente dal vocabolario verificato")
        if manifesto is None:
            checks["manifesto"] = "non_fornito: digest dichiarato, non verificato"
        else:
            manifest_raw = snapshots[Path(manifesto).resolve()]
            checks["manifesto"] = {"sha256": sha(manifest_raw)}
            if sha(manifest_raw) != base["manifesto_sha256"]:
                problems.append("Hash manifesto incompatibile")
        git_info, base_decisions = verifica_git(repository, base, seen)
        problems.extend(git_info["problemi_base"])
        if base["curatela_revisione_git_base"] is None and sha(snapshots[paths[1]]) != base["curatela_sha256"]:
            problems.append("Senza base Git, hash curatela corrente diverso dalla base")
    candidate = json_bytes(serializza(current_doc))
    for row in sorted(prepared, key=lambda r: r["parola"]):
        if "categoria" in row:
            continue
        word, decision, previous = row["parola"], row["proposta"], row["decisione_base"]
        if problems:
            category, reason = "BASE_INCOMPATIBILE", "; ".join(problems)
        elif base_decisions is not None and previous != base_decisions.get(word):
            category, reason = "BASE_INCOMPATIBILE", "decisione_base diversa dal commit dichiarato"
        elif previous != row["corrente"]:
            category, reason = "CONFLITTO", "decisione_base diversa dalla decisione corrente"
        elif word in git_info["parole_modificate"]:
            category, reason = "RICHIEDE_CONTROLLO_STORICO", "Parola modificata dopo la base (anche ABA)"
        elif not git_info["storico_verificato"]:
            category, reason = "RICHIEDE_CONTROLLO_STORICO", "; ".join(git_info["problemi_storico"])
        elif decision == row["corrente"]:
            category, reason = "IDEMPOTENTE", "Decisione gia' esattamente presente: nessuna modifica"
        elif controls:
            category, reason = "RICHIEDE_CONTROLLO", "; ".join(controls)
        else:
            category, reason = "APPLICABILE", "Base della parola e storico verificati"
            candidate["decisioni"][word] = decision
        row.update(categoria=category, motivo=reason)
    prepared.sort(key=lambda r: r["parola"])
    totals = Counter(r["categoria"] for r in prepared)
    report = {"schema_version": 1, "tipo": "rapporto_merge_proposte_curatela",
              "sessione_id": p["sessione_id"], "base_dichiarata": p["base"],
              "proposte_sha256": sha(snapshots[paths[0]]),
              "curatela_corrente_sha256": sha(snapshots[paths[1]]),
              "numero_decisioni": len(prepared),
              "riepilogo": {c: totals[c] for c in CATEGORIE},
              "problemi_base": problems, "richiede_controllo": controls,
              "git": git_info, "verifiche": checks, "dettaglio": prepared,
              "curatela_candidata_sha256": None}
    for path, data in snapshots.items():
        require(leggi_bytes(path) == data, "Input cambiato durante l'analisi: " + str(path))
    if git_info["head"] is not None:
        require(Git(repository).head() == git_info["head"], "HEAD cambiata durante l'analisi")
    return report, candidate


def output_esterno(path, repository, inputs):
    path = Path(path).resolve()
    roots = {ROOT.resolve(), Path(repository).resolve()}
    try:
        roots.add(Path(Git(repository).run("rev-parse", "--show-toplevel").decode().strip()).resolve())
    except (ValueError, OSError, subprocess.TimeoutExpired):
        # L'analisi segnalera' il Git non verificabile; i confini espliciti restano.
        pass
    for root in roots:
        require(path != root and root not in path.parents, "Output obbligatoriamente fuori repository")
    require(path not in {Path(p).resolve() for p in inputs}, "Output coincide con un input")
    require(not path.exists(), "Output gia' esistente: non sovrascrivo")
    require(path.parent.is_dir(), "La cartella esterna di output deve gia' esistere")
    return path


def esegui(proposte, curatela, report_path, *, candidata=None, repository=ROOT,
           vocabolario=None, manifesto=None):
    inputs = [proposte, curatela] + [p for p in (vocabolario, manifesto) if p is not None]
    report_path = output_esterno(report_path, repository, inputs)
    candidate_path = output_esterno(candidata, repository, inputs) if candidata is not None else None
    require(candidate_path != report_path, "Report e candidata devono essere file distinti")
    report, candidate = analizza(proposte, curatela, repository=repository,
                                vocabolario=vocabolario, manifesto=manifesto)
    data = serializza(candidate)
    if candidate_path is not None:
        report["curatela_candidata_sha256"] = sha(data)
    # Prenota entrambi i nomi con creazione esclusiva; mai replace/apply in place.
    created, streams = [], []
    try:
        for path in [report_path] + ([candidate_path] if candidate_path is not None else []):
            streams.append(path.open("xb"))
            created.append(path)
        streams[0].write(serializza(report))
        if candidate_path is not None:
            streams[1].write(data)
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
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proposte", type=Path, required=True, help="Un solo export cumulativo")
    parser.add_argument("--curatela", type=Path, required=True, help="Snapshot corrente scelto esplicitamente")
    parser.add_argument("--repository", type=Path, default=ROOT, help="Repository per sola verifica Git")
    parser.add_argument("--vocabolario", type=Path, help="Necessario per proposte applicabili")
    parser.add_argument("--manifesto", type=Path, help="Opzionale: verifica digest del manifesto originale")
    parser.add_argument("--report", type=Path, required=True, help="Nuovo JSON fuori repository")
    parser.add_argument("--candidata", type=Path, help="Solo esplicito: nuovo JSON fuori repository")
    args = parser.parse_args()
    try:
        report = esegui(args.proposte, args.curatela, args.report, candidata=args.candidata,
                        repository=args.repository, vocabolario=args.vocabolario, manifesto=args.manifesto)
        print(json.dumps(report["riepilogo"], ensure_ascii=True, sort_keys=True))
        return 0 if all(r["categoria"] in ("APPLICABILE", "IDEMPOTENTE") for r in report["dettaglio"]) and not report["problemi_base"] else 1
    except (OSError, ValueError, TypeError, KeyError, subprocess.TimeoutExpired) as exc:
        print("Merge rifiutato: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
