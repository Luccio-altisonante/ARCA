#!/usr/bin/env python3
"""Estrae le forme italiane dai dati JSONL di Wiktextract/Kaikki."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
from collections import Counter
from pathlib import Path
import sys
import unicodedata


APOSTROFI = {"'", "\u2019", "\u02bc"}
CARATTERI_RISERVATI = "?*$!&^%,"


def apri_jsonl(percorso: Path):
    if percorso.suffix.lower() == ".gz":
        return gzip.open(percorso, "rt", encoding="utf-8", newline="")
    return percorso.open("r", encoding="utf-8", newline="")


def normalizza_forma(valore: object) -> tuple[str | None, str | None]:
    if not isinstance(valore, str):
        return None, "tipo_non_stringa"

    forma = unicodedata.normalize("NFC", valore.lower().strip())

    if not forma:
        return None, "vuota"
    if any(carattere.isspace() for carattere in forma):
        return forma, "whitespace"
    if any(carattere in CARATTERI_RISERVATI for carattere in forma):
        return forma, "carattere_riservato"
    if any(unicodedata.category(carattere).startswith("C") for carattere in forma):
        return None, "carattere_di_controllo"
    if not any(unicodedata.category(carattere).startswith("L") for carattere in forma):
        return None, "senza_lettere"

    return forma, None


def ha_accenti(forma: str) -> bool:
    decomposta = unicodedata.normalize("NFD", forma)
    return any(unicodedata.combining(carattere) for carattere in decomposta)


def ha_trattino(forma: str) -> bool:
    return any(carattere == "-" or unicodedata.category(carattere) == "Pd" for carattere in forma)


def sha256_file(percorso: Path) -> str:
    digest = hashlib.sha256()
    with percorso.open("rb") as sorgente:
        for blocco in iter(lambda: sorgente.read(1024 * 1024), b""):
            digest.update(blocco)
    return digest.hexdigest()


def estrai_forme(percorso: Path) -> tuple[set[str], dict[str, object]]:
    forme: set[str] = set()
    forme_escluse_whitespace: set[str] = set()
    forme_escluse_caratteri_riservati: set[str] = set()
    contatori: Counter[str] = Counter()

    with apri_jsonl(percorso) as sorgente:
        for numero_riga, riga in enumerate(sorgente, start=1):
            contatori["righe_jsonl"] += 1
            try:
                voce = json.loads(riga)
            except json.JSONDecodeError as errore:
                raise ValueError(f"JSON non valido alla riga {numero_riga}: {errore}") from errore

            if not isinstance(voce, dict):
                contatori["record_non_oggetto"] += 1
                continue
            if voce.get("lang_code") != "it":
                continue

            contatori["record_italiani"] += 1
            candidati: list[tuple[str, object]] = [("headword", voce.get("word"))]
            forms = voce.get("forms") or []
            if isinstance(forms, list):
                for elemento in forms:
                    if isinstance(elemento, dict):
                        candidati.append(("forma", elemento.get("form")))
                    else:
                        contatori["forme_non_oggetto"] += 1
            else:
                contatori["campo_forms_non_lista"] += 1

            for origine, candidato in candidati:
                contatori[f"candidati_{origine}"] += 1
                forma, motivo = normalizza_forma(candidato)
                if motivo is not None:
                    contatori[f"esclusi_{motivo}"] += 1
                    if motivo == "whitespace" and forma is not None:
                        forme_escluse_whitespace.add(forma)
                    if motivo == "carattere_riservato" and forma is not None:
                        forme_escluse_caratteri_riservati.add(forma)
                    continue
                if forma in forme:
                    contatori["duplicati"] += 1
                else:
                    forme.add(forma)

    statistiche: dict[str, object] = dict(sorted(contatori.items()))
    statistiche.update(
        {
            "forme_uniche": len(forme),
            "forme_accentate": sum(ha_accenti(forma) for forma in forme),
            "forme_con_apostrofo": sum(any(c in APOSTROFI for c in forma) for forma in forme),
            "forme_con_trattino": sum(ha_trattino(forma) for forma in forme),
            "forme_con_spazi": sum(any(c.isspace() for c in forma) for forma in forme),
            "forme_uniche_escluse_whitespace": len(forme_escluse_whitespace),
            "forme_uniche_escluse_caratteri_riservati": len(
                forme_escluse_caratteri_riservati
            ),
            "elenco_forme_escluse_caratteri_riservati": sorted(
                forme_escluse_caratteri_riservati
            ),
            "forme_con_caratteri_riservati": {
                carattere: sum(carattere in forma for forma in forme)
                for carattere in CARATTERI_RISERVATI
            },
            "esempi_caratteri_riservati": {
                carattere: sorted(forma for forma in forme if carattere in forma)[:10]
                for carattere in CARATTERI_RISERVATI
            },
        }
    )
    return forme, statistiche


def carica_insieme(percorso: Path) -> tuple[set[str], Counter[str]]:
    forme: set[str] = set()
    contatori: Counter[str] = Counter()
    with percorso.open("r", encoding="utf-8-sig", newline="") as sorgente:
        for riga in sorgente:
            contatori["righe"] += 1
            forma, motivo = normalizza_forma(riga)
            if motivo is not None:
                contatori[f"esclusi_{motivo}"] += 1
                continue
            if forma in forme:
                contatori["duplicati"] += 1
            forme.add(forma)
    return forme, contatori


def scrivi_estrazione(percorso: Path, forme: set[str]) -> None:
    percorso.parent.mkdir(parents=True, exist_ok=True)
    temporaneo = percorso.with_name(percorso.name + ".tmp")
    try:
        with temporaneo.open("w", encoding="utf-8", newline="\n") as destinazione:
            for forma in sorted(forme):
                destinazione.write(forma)
                destinazione.write("\n")
        os.replace(temporaneo, percorso)
    finally:
        if temporaneo.exists():
            temporaneo.unlink()


def crea_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Estrae headword e forms delle sole voci italiane da un file "
            "Wiktextract JSONL o JSONL.GZ."
        )
    )
    parser.add_argument("input", type=Path, help="dump Wiktextract .jsonl o .jsonl.gz")
    parser.add_argument("output", type=Path, help="file intermedio estratto da generare")
    parser.add_argument(
        "--confronta",
        type=Path,
        metavar="VOCABOLARIO",
        help="confronta il risultato con un vocabolario esistente",
    )
    parser.add_argument(
        "--report-json",
        type=Path,
        metavar="FILE",
        help="salva statistiche e confronto anche come JSON UTF-8",
    )
    return parser


def main() -> int:
    args = crea_parser().parse_args()
    if not args.input.is_file():
        print(f"File di input non trovato: {args.input}", file=sys.stderr)
        return 2

    forme, statistiche = estrai_forme(args.input)
    scrivi_estrazione(args.output, forme)

    report: dict[str, object] = {
        "input": str(args.input.resolve()),
        "input_sha256": sha256_file(args.input),
        "output": str(args.output.resolve()),
        "output_sha256": sha256_file(args.output),
        "dimensione_output_byte": args.output.stat().st_size,
        "estrazione": statistiche,
    }

    if args.confronta is not None:
        vecchie, contatori_vecchie = carica_insieme(args.confronta)
        report["confronto"] = {
            "vocabolario_precedente": str(args.confronta.resolve()),
            "righe_precedenti": contatori_vecchie["righe"],
            "forme_uniche_precedenti": len(vecchie),
            "forme_uniche_nuove": len(forme),
            "forme_comuni": len(vecchie & forme),
            "solo_precedente": len(vecchie - forme),
            "solo_nuovo": len(forme - vecchie),
            "duplicati_precedenti": contatori_vecchie["duplicati"],
        }

    if args.report_json is not None:
        args.report_json.parent.mkdir(parents=True, exist_ok=True)
        args.report_json.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
