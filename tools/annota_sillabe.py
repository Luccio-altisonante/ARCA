#!/usr/bin/env python3
"""Annotazione offline; non modifica vocabolario, core o curatela ufficiale."""

from __future__ import annotations

import argparse
from collections import Counter
from contextlib import ExitStack
import csv
from dataclasses import dataclass, field
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata

from evidenze_ipa import PARSER_VERSION, analizza_ipa
from audit_sillabe import AuditPrecedente


CURATELA_SCHEMA_VERSION = 1
ANNOTAZIONI_SCHEMA_VERSION = 2
MANIFESTO_SCHEMA_VERSION = 2
POLITICA_VERSION = "offline-v2-evidenze"
STATI = ("RISOLTO", "STIMA_CORROBORATA", "AMBIGUO", "CONFLITTO", "SOLO_STIMA", "DA_RIVEDERE", "ESCLUDI")
WIKIPRON_COMMIT = "960eba421beae7ded634f545b98922fa03e6b19f"
WIKIPRON_SHA256 = "b81cc2c901b685de08f1a4428de36f39cd7b0d59fee15f7c6000f1e61a1f75a2"
WIKIPRON_URL = (f"https://raw.githubusercontent.com/CUNY-CL/wikipron/{WIKIPRON_COMMIT}/"
                "data/scrape/tsv/ita_latn_broad.tsv")
MACRO_FAMIGLIE = {"wiktionary": "wiktionary", "wiktionary_ipa": "wiktionary",
                  "wikipron": "wiktionary", "phonitalia": "phonitalia"}
ROOT = Path(__file__).resolve().parent.parent
SORGENTI_RUNNER = ("core/sillabe.cpp", "core/sillabe.hpp", "core/unicode.cpp",
    "core/unicode.hpp", "third_party/utf8proc/utf8proc.c", "third_party/utf8proc/utf8proc.h",
    "third_party/utf8proc/utf8proc_data.c", "tools/conta_sillabe_batch.cpp")


def normalizza(parola: str) -> str:
    return unicodedata.normalize("NFC", parola.lower().strip())


def senza_accenti(parola: str) -> str:
    # Soltanto controllo della ricomposizione; mai chiave di associazione.
    return "".join(c for c in unicodedata.normalize("NFD", parola)
                   if not unicodedata.combining(c))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def descrivi_file(path: Path) -> dict:
    return {"percorso": str(path.resolve()), "sha256": sha256_file(path),
            "byte": path.stat().st_size}


def leggi_vocabolario(path: Path) -> list[str]:
    parole = path.read_text(encoding="utf-8-sig").splitlines()
    viste = set()
    for indice, parola in enumerate(parole, 1):
        if not parola or normalizza(parola) != parola or any(c.isspace() for c in parola):
            raise ValueError(f"Grafia non canonica alla riga {indice}: {parola!r}")
        if parola in viste:
            raise ValueError(f"Grafia duplicata alla riga {indice}: {parola!r}")
        viste.add(parola)
    if not parole:
        raise ValueError("Vocabolario vuoto")
    return parole


@dataclass
class Evidenza:
    conteggi: set[int] = field(default_factory=set)
    righe: set[int] = field(default_factory=set)
    anomalie: set[str] = field(default_factory=set)
    testimoni: dict[int, int] = field(default_factory=dict)
    pronunce: set[tuple[str, int, int]] = field(default_factory=set)
    assenze: set[str] = field(default_factory=set)
    testimoni_ipa: dict[int, str] = field(default_factory=dict)
    testimoni_anomalie: dict[str, dict] = field(default_factory=dict)
    testimoni_sillabazioni: dict[int, list[str]] = field(default_factory=dict)
    testimoni_phonitalia: dict[int, dict] = field(default_factory=dict)

    def aggiungi(self, numero: int, riga: int) -> None:
        self.conteggi.add(numero)
        self.righe.add(riga)
        self.testimoni.setdefault(numero, riga)

    def serializza(self, famiglia: str | None = None) -> dict:
        dato = {"conteggi": sorted(self.conteggi), "righe": sorted(self.righe),
                "anomalie": sorted(self.anomalie)}
        if self.testimoni:
            dato["testimoni_per_conteggio"] = {
                str(n): self.testimoni[n] for n in sorted(self.testimoni)}
        if self.pronunce:
            dato["analisi_fonetiche_distinte"] = len(self.pronunce)
        if self.assenze:
            dato["assenze_dichiarate"] = sorted(self.assenze)
        if famiglia:
            dato["macro_famiglia"] = famiglia
        if self.testimoni_ipa:
            dato["testimoni_ipa"] = {str(n): self.testimoni_ipa[n] for n in sorted(self.testimoni_ipa)}
        if self.testimoni_anomalie:
            dato["testimoni_anomalie"] = self.testimoni_anomalie
        if self.testimoni_sillabazioni:
            dato["testimoni_sillabazioni"] = {str(n): self.testimoni_sillabazioni[n]
                                             for n in sorted(self.testimoni_sillabazioni)}
        if self.testimoni_phonitalia:
            dato["testimoni_phonitalia"] = {str(n): self.testimoni_phonitalia[n]
                                           for n in sorted(self.testimoni_phonitalia)}
        return dato


def apri_jsonl(path: Path):
    if path.suffix.lower() == ".gz":
        return gzip.open(path, "rt", encoding="utf-8")
    return path.open("r", encoding="utf-8")


def aggiungi_ipa(evidenza: Evidenza, testo: object, riga: int, *, segmentato: bool = False) -> None:
    analisi = analizza_ipa(testo, segmentato=segmentato)
    evidenza.righe.add(riga)
    evidenza.anomalie.update(analisi.anomalie)
    for motivo in sorted(analisi.anomalie):
        evidenza.testimoni_anomalie.setdefault(motivo, {"riga": riga,
            "ipa": testo[:240] if isinstance(testo, str) else None})
    for n in analisi.conteggi:
        evidenza.aggiungi(n, riga)
        evidenza.testimoni_ipa.setdefault(n, analisi.testimoni[n])


def carica_wiktionary_completa(path: Path, vocabolario: set[str]) -> tuple[dict, dict, dict, dict]:
    dati = {}
    stats = Counter()
    ipa = {}
    ipa_stats = Counter()
    with apri_jsonl(path) as stream:
        for riga, testo in enumerate(stream, 1):
            stats["righe"] += 1
            voce = json.loads(testo)
            if not isinstance(voce, dict) or voce.get("lang_code") != "it":
                continue
            if not isinstance(voce.get("word"), str):
                continue
            parola = normalizza(voce["word"])
            if parola not in vocabolario:
                continue
            stats["voci_associate"] += 1
            sounds = voce.get("sounds")
            if sounds is not None and not isinstance(sounds, list):
                evidenza_ipa = ipa.setdefault(parola, Evidenza())
                evidenza_ipa.righe.add(riga)
                evidenza_ipa.anomalie.add("sounds_non_lista")
                ipa_stats["sounds_non_lista"] += 1
            elif isinstance(sounds, list):
                for sound in sounds:
                    if not isinstance(sound, dict) or "ipa" not in sound:
                        continue
                    evidenza_ipa = ipa.setdefault(parola, Evidenza())
                    aggiungi_ipa(evidenza_ipa, sound["ipa"], riga)
                    ipa_stats["trascrizioni_associate"] += 1
            sillabazioni = voce.get("hyphenations")
            if not sillabazioni:
                continue
            evidenza = dati.setdefault(parola, Evidenza())
            if not isinstance(sillabazioni, list):
                evidenza.righe.add(riga)
                evidenza.anomalie.add("hyphenations_non_lista")
                stats["sillabazioni_scartate"] += 1
                continue
            for item in sillabazioni:
                parti = item.get("parts") if isinstance(item, dict) else None
                motivo = None
                if not isinstance(parti, list) or not parti or not all(
                        isinstance(p, str) and p.strip() for p in parti):
                    motivo = "parti_incomplete"
                elif any("divisione in sillabe mancante" in p.lower() for p in parti):
                    motivo = "sillabazione_mancante"
                else:
                    parti = [normalizza(p) for p in parti]
                    if any(any(c.isspace() for c in p) for p in parti):
                        motivo = "spazi_nelle_parti"
                    elif senza_accenti("".join(parti)) != senza_accenti(parola):
                        motivo = "parti_non_ricompongono_la_grafia"
                evidenza.righe.add(riga)
                if motivo == "sillabazione_mancante":
                    evidenza.assenze.add(motivo)
                    stats["sillabazioni_dichiarate_mancanti"] += 1
                elif motivo:
                    evidenza.anomalie.add(motivo)
                    stats["sillabazioni_scartate"] += 1
                else:
                    evidenza.aggiungi(len(parti), riga)
                    evidenza.testimoni_sillabazioni.setdefault(len(parti), parti)
                    stats["sillabazioni_valide"] += 1
    ipa_stats["grafie_con_ipa"] = len(ipa)
    ipa_stats["grafie_con_conteggio"] = sum(bool(e.conteggi) for e in ipa.values())
    ipa_stats["grafie_con_anomalie"] = sum(bool(e.anomalie) for e in ipa.values())
    return dati, dict(stats), ipa, dict(ipa_stats)


def carica_wiktionary(path: Path, vocabolario: set[str]) -> tuple[dict, dict]:
    dati, stats, _, _ = carica_wiktionary_completa(path, vocabolario)
    return dati, stats


def carica_wikipron(path: Path, vocabolario: set[str]) -> tuple[dict[str, Evidenza], dict]:
    dati = {}
    stats = Counter()
    with path.open(encoding="utf-8-sig", newline="") as stream:
        for riga, testo in enumerate(stream, 1):
            stats["righe"] += 1
            fields = testo.rstrip("\r\n").split("\t")
            if len(fields) != 2 or not fields[0].strip():
                raise ValueError(f"Riga WikiPron malformata: {riga}")
            parola = normalizza(fields[0])
            if parola not in vocabolario:
                continue
            stats["righe_associate"] += 1
            evidenza = dati.setdefault(parola, Evidenza())
            aggiungi_ipa(evidenza, fields[1], riga, segmentato=True)
    stats["grafie_associate"] = len(dati)
    stats["grafie_con_conteggio"] = sum(bool(e.conteggi) for e in dati.values())
    stats["grafie_con_anomalie"] = sum(bool(e.anomalie) for e in dati.values())
    return dati, dict(stats)


def grafia_phonitalia(voce: dict) -> str:
    # Convenzione originale: apostrofo dopo la vocale finale = accento.
    grafia = re.sub(r"([aeiou])'", lambda m: m[1] + "\u0300", voce["word"])
    if voce["word"].endswith("'") and voce["Phones"][-1:] in ("e", "o"):
        grafia = re.sub("([eo])\u0300", lambda m: m[1] + "\u0301", grafia)
    return normalizza(grafia)


def carica_phonitalia(path: Path, vocabolario: set[str]) -> tuple[dict[str, Evidenza], dict]:
    dati = {}
    stats = Counter()
    richiesti = {"word", "Phones", "PhoneSyll", "StressedSyllable", "SumSylls"}
    with path.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, delimiter="\t")
        if not richiesti.issubset(reader.fieldnames or []):
            raise ValueError("Intestazione PhonItalia incompleta")
        for riga, voce in enumerate(reader, 2):
            stats["righe"] += 1
            if not isinstance(voce.get("word"), str) or not isinstance(voce.get("Phones"), str):
                raise ValueError(f"Record PhonItalia incompleto alla riga {riga}")
            parola = grafia_phonitalia(voce)
            if parola not in vocabolario:
                continue
            stats["righe_associate"] += 1
            evidenza = dati.setdefault(parola, Evidenza())
            evidenza.righe.add(riga)
            try:
                numero = int(voce["SumSylls"])
                tonica = int(voce["StressedSyllable"])
                if numero < 1 or not 1 <= tonica <= numero or not voce["PhoneSyll"]:
                    raise ValueError("Conteggio/analisi non validi")
            except (TypeError, ValueError):
                evidenza.anomalie.add("conteggio_o_pronuncia_non_validi")
                stats["righe_scartate"] += 1
                continue
            evidenza.aggiungi(numero, riga)
            evidenza.pronunce.add((voce["PhoneSyll"], tonica, numero))
            evidenza.testimoni_phonitalia.setdefault(numero, {"phone_syll": voce["PhoneSyll"],
                                                            "sillaba_tonica": tonica})
    return dati, dict(stats)


def _oggetto_senza_duplicati(items: list[tuple]) -> dict:
    risultato = {}
    for chiave, valore in items:
        if chiave in risultato:
            raise ValueError(f"Chiave JSON duplicata: {chiave!r}")
        risultato[chiave] = valore
    return risultato


def carica_curatela(path: Path) -> dict:
    dato = json.loads(path.read_text(encoding="utf-8"),
                      object_pairs_hook=_oggetto_senza_duplicati)
    if not isinstance(dato, dict) or type(dato.get("schema_version")) is not int or \
            dato.get("schema_version") != CURATELA_SCHEMA_VERSION or \
            dato.get("tipo") != "curatela_ufficiale" or not isinstance(dato.get("decisioni"), dict):
        raise ValueError("Formato curatela ufficiale non valido")
    for parola, decisione in dato["decisioni"].items():
        if not parola or normalizza(parola) != parola or any(c.isspace() for c in parola):
            raise ValueError(f"Chiave di curatela non canonica: {parola!r}")
        if not isinstance(decisione, dict):
            raise ValueError(f"Decisione non valida per {parola}")
        azione = decisione.get("azione")
        if azione not in ("CONFERMA", "AMBIGUO", "DA_RIVEDERE", "ESCLUDI"):
            raise ValueError(f"Azione non valida per {parola}: {azione}")
        numeri = decisione.get("conteggi")
        if not isinstance(numeri, list) or any(type(n) is not int or n < 1 for n in numeri) \
                or numeri != sorted(set(numeri)):
            raise ValueError(f"Conteggi non validi per {parola}")
        if (azione == "CONFERMA" and len(numeri) != 1) or \
                (azione == "AMBIGUO" and len(numeri) < 2) or \
                (azione in ("DA_RIVEDERE", "ESCLUDI") and numeri):
            raise ValueError(f"Conteggi incompatibili con {azione} per {parola}")
        for campo in ("autore", "data", "motivazione"):
            if not isinstance(decisione.get(campo), str) or not decisione[campo].strip():
                raise ValueError(f"Campo {campo} mancante per {parola}")
        try:
            datetime.fromisoformat(decisione["data"])
        except ValueError as exc:
            raise ValueError(f"Data non valida per {parola}") from exc
    return dato["decisioni"]


def classifica(algoritmo: int, wik: Evidenza, phon: Evidenza,
               ipa: Evidenza | None = None, wikipron: Evidenza | None = None) -> dict:
    segnali = {"wiktionary": wik, "wiktionary_ipa": ipa or Evidenza(),
               "wikipron": wikipron or Evidenza(), "phonitalia": phon}
    attivi_w = [e.conteggi for nome, e in segnali.items()
                if MACRO_FAMIGLIE[nome] == "wiktionary" and e.conteggi]
    w = set().union(*attivi_w)
    p = phon.conteggi
    candidati = sorted(w | p)
    non_bloccanti = []
    for nome in ("wiktionary_ipa", "wikipron"):
        e = segnali[nome]
        if e.anomalie == {"vocali_adiacenti_non_disambiguate"} and \
                wik.conteggi and wik.conteggi == p and not (wik.anomalie or phon.anomalie) and \
                e.conteggi and e.conteggi <= wik.conteggi:
            non_bloccanti.append(nome)
    anomalie = any(e.anomalie for nome, e in segnali.items() if nome not in non_bloccanti)
    # A subset supports an alternative; it does not deny the others. Disjoint
    # analyses in one family are a conflict, never evidence for true ambiguity.
    contrasto_interno = bool(attivi_w) and not set.intersection(*attivi_w)
    contrasto_hyphenation_phonitalia = bool(wik.conteggi and p and wik.conteggi != p)
    concordanti = bool(w and p and w == p)
    famiglie = {"wiktionary": sorted(w), "phonitalia": sorted(p)}
    n_famiglie = sum(bool(ns) for ns in famiglie.values())
    corroborazioni = [nome for nome, e in segnali.items()
                      if e.conteggi == {algoritmo} and not e.anomalie]
    if contrasto_interno or contrasto_hyphenation_phonitalia or (w and p and w != p):
        stato, conteggi, motivo, livello = (
            "CONFLITTO", [], "contrasto_interno_famiglia_wiktionary" if contrasto_interno
            else "hyphenation_phonitalia_discordanti" if contrasto_hyphenation_phonitalia
            else "macro_famiglie_lessicali_discordanti", "altra_evidenza_lessicale")
    elif anomalie or algoritmo < 1:
        stato, conteggi, motivo, livello = (
            "DA_RIVEDERE", [], "dato_incompleto_o_sospetto", "altra_evidenza_lessicale"
            if candidati else "stima_euristica")
    elif concordanti and len(w) == 1:
        stato, conteggi, motivo, livello = (
            "RISOLTO", sorted(w), "due_macro_famiglie_univoche_concordanti", "evidenza_concordante")
    elif concordanti and len(w) > 1 and any(ns == w for ns in attivi_w) and \
            len({x[0] for x in phon.pronunce}) >= 2:
        stato, conteggi, motivo, livello = (
            "AMBIGUO", sorted(w), "alternative_corroborate_da_due_macro_famiglie", "evidenza_concordante")
    elif len(candidati) > 1:
        stato, conteggi, motivo, livello = (
            "DA_RIVEDERE", [], "alternative_non_corroborate", "altra_evidenza_lessicale")
    elif candidati:
        stato = "STIMA_CORROBORATA" if candidati[0] == algoritmo else "DA_RIVEDERE"
        conteggi, motivo, livello = (candidati if stato == "STIMA_CORROBORATA" else [],
                                   "una_macro_famiglia_univoca_con_stima_concordante"
                                   if stato == "STIMA_CORROBORATA" else "famiglia_univoca_diversa_dalla_stima",
                                   "stima_corroborata" if stato == "STIMA_CORROBORATA"
                                   else "altra_evidenza_lessicale")
    else:
        stato, conteggi, motivo, livello = (
            "SOLO_STIMA", [algoritmo], "nessuna_evidenza_lessicale", "stima_euristica")
    return {"stato": stato, "conteggi": conteggi, "candidati_lessicali": candidati,
            "motivo": motivo, "precedenza": livello, "fonti_concordanti": concordanti,
            "macro_famiglie": famiglie, "macro_famiglie_indipendenti": n_famiglie,
            "corroborazioni": corroborazioni, "contrasto_interno_wiktionary": contrasto_interno,
            "avvertenze_compatibili_con_consenso_preesistente": non_bloccanti,
            "anomalie": {nome: sorted(e.anomalie) for nome, e in segnali.items() if e.anomalie}}


def crea_record(indice: int, parola: str, algoritmo: int, wik: Evidenza,
                phon: Evidenza, decisione: dict | None = None, *,
                ipa: Evidenza | None = None, wikipron: Evidenza | None = None) -> dict:
    automatico = classifica(algoritmo, wik, phon, ipa, wikipron)
    record = {"schema_version": ANNOTAZIONI_SCHEMA_VERSION, "politica_version": POLITICA_VERSION,
              "indice": indice, "parola": parola, "algoritmo": algoritmo,
              "wiktionary": wik.serializza("wiktionary"), "phonitalia": phon.serializza("phonitalia"),
              "wiktionary_ipa": (ipa or Evidenza()).serializza("wiktionary"),
              "wikipron": (wikipron or Evidenza()).serializza("wiktionary"),
              "automatico": automatico, "conteggi": automatico["conteggi"],
              "stato": automatico["stato"], "origine": "automatico",
              "precedenza": automatico["precedenza"],
              "esclusione_in_attesa": False}
    if decisione is not None:
        azione = decisione["azione"]
        record.update(conteggi=decisione["conteggi"],
                      stato="RISOLTO" if azione == "CONFERMA" else azione,
                      origine="curatela_ufficiale", precedenza="curatela_ufficiale",
                      decisione_manuale=decisione)
        record["esclusione_in_attesa"] = azione == "ESCLUDI"
    record["richiede_revisione"] = (record["stato"] == "DA_RIVEDERE" or
        (record["origine"] == "automatico" and record["stato"] != "RISOLTO"))
    record["priorita_revisione"] = ("nessuna" if not record["richiede_revisione"] else
        "stime_non_verificate" if record["stato"] == "SOLO_STIMA" else
        "stime_corroborate" if record["stato"] == "STIMA_CORROBORATA" else "prioritaria")
    return record


def calcola_algoritmo(runner: Path, parole: list[str]) -> list[int]:
    processo = subprocess.run([str(runner.resolve())],
        input=("\n".join(parole) + "\n").encode("utf-8"), capture_output=True, check=True)
    righe = processo.stdout.decode("ascii").splitlines()
    if len(righe) != len(parole) or any(not re.fullmatch(r"\d+", r) for r in righe):
        raise ValueError("Il runner deve restituire esattamente un intero per grafia")
    return [int(r) for r in righe]


def verifica_runner(runner: Path) -> dict:
    path = Path(str(runner) + ".build.json")
    dato = json.loads(path.read_text(encoding="utf-8-sig"),
                      object_pairs_hook=_oggetto_senza_duplicati)
    if not isinstance(dato, dict) or type(dato.get("schema_version")) is not int or \
            dato.get("schema_version") != 1 or dato.get("runner_sha256") != sha256_file(runner):
        raise ValueError("Runner non compatibile con il manifesto della build")
    sorgenti = dato.get("sorgenti")
    if not isinstance(sorgenti, dict) or set(sorgenti) != set(SORGENTI_RUNNER):
        raise ValueError("Provenienza dei sorgenti del runner incompleta")
    for relativo, digest in sorgenti.items():
        if sha256_file(ROOT / relativo) != digest:
            raise ValueError(f"Runner obsoleto: ricompilare dopo la modifica di {relativo}")
    return dato


def scrivi_json(path: Path, dato: object) -> None:
    path.write_text(json.dumps(dato, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8", newline="\n")


def esegui_pipeline(vocabolario: Path, wiktionary: Path, phonitalia: Path,
                    curatela: Path, runner: Path, output: Path, *,
                    wikipron: Path | None = None, precedente: Path | None = None) -> dict:
    output = output.resolve()
    if output == ROOT.resolve() or ROOT.resolve() in output.parents:
        raise ValueError("Gli artefatti completi devono restare fuori dal repository")
    if output.exists():
        raise ValueError("La directory di output esiste gia'; scegliere una nuova esecuzione")
    build_info = verifica_runner(runner)
    paths = {"vocabolario": vocabolario, "wiktionary": wiktionary, "phonitalia": phonitalia,
             "curatela": curatela, "runner": runner, "runner_build": Path(str(runner) + ".build.json"),
             "pipeline": Path(__file__).resolve(), "parser_ipa": Path(__file__).with_name("evidenze_ipa.py"),
             "audit": Path(__file__).with_name("audit_sillabe.py")}
    if wikipron is not None:
        paths["wikipron"] = wikipron
    if precedente is not None:
        paths["annotazioni_precedenti"] = precedente
    input_info = {nome: descrivi_file(path) for nome, path in paths.items()}
    if wikipron is not None:
        if input_info["wikipron"]["sha256"] != WIKIPRON_SHA256:
            raise ValueError("SHA-256 WikiPron diverso dal TSV broad italiano valutato")
        input_info["wikipron"].update(commit=WIKIPRON_COMMIT, provenienza=WIKIPRON_URL,
            macro_famiglia="wiktionary", licenza_dati="Dati derivati da Wiktionary: licenza, attribuzione e share-alike della fonte; NON Apache 2 del codice WikiPron.")
    input_info["wiktionary"].update(versione=wiktionary.name,
        provenienza="https://kaikki.org/dictionary/Italian/", macro_famiglia="wiktionary",
        licenza_dati="Wiktionary; attribuzione e condizioni in DATASET.md, non licenza del codice Wiktextract")
    input_info["phonitalia"].update(versione="PhonItalia 1.10 / phonItaliaR 1.0.0",
        provenienza="https://stefanocoretta.github.io/phonItaliaR/", macro_famiglia="phonitalia",
        licenza_dati="CC BY 4.0; Goslin, Galuzzi, Romani; package Coretta")
    print("Lettura vocabolario e conta_sillabe C++...", file=sys.stderr, flush=True)
    parole = leggi_vocabolario(vocabolario)
    decisioni = carica_curatela(curatela)
    conteggi = calcola_algoritmo(runner, parole)
    insieme = set(parole)
    print("Associazione Wiktionary locale...", file=sys.stderr, flush=True)
    wik, wik_stats, ipa, ipa_stats = carica_wiktionary_completa(wiktionary, insieme)
    print("Associazione PhonItalia locale...", file=sys.stderr, flush=True)
    phon, phon_stats = carica_phonitalia(phonitalia, insieme)
    print("Associazione WikiPron locale...", file=sys.stderr, flush=True)
    wp, wp_stats = carica_wikipron(wikipron, insieme) if wikipron else ({}, {})
    output.parent.mkdir(parents=True, exist_ok=True)
    temporaneo = Path(tempfile.mkdtemp(prefix=output.name + "-", dir=output.parent))
    audit = AuditPrecedente(None)
    try:
        audit = AuditPrecedente(precedente)
        stats = {"totale": len(parole), "stati": Counter(), "stati_automatici": Counter(),
                 "origini": Counter(), "copertura": Counter(), "revisione": Counter(),
                 "distribuzione_algoritmo": Counter(), "distribuzione_conteggi_singoli": Counter(),
                 "distribuzione_insiemi_multipli": Counter(), "esempi": {},
                 "wiktionary": wik_stats, "phonitalia": phon_stats,
                 "wiktionary_ipa": ipa_stats, "wikipron": wp_stats,
                 "anomalie_per_segnale": {}, "macro_famiglie_indipendenti": Counter(),
                 "sovrapposizioni_segnali": Counter(), "code": Counter()}
        vuota = Evidenza()
        with ExitStack() as stack:
            files = {nome: stack.enter_context((temporaneo / (nome + ".jsonl")).open(
                "w", encoding="utf-8", newline="\n")) for nome in ("annotazioni", "revisione_prioritaria",
                "stime_non_verificate", "stime_corroborate", "esclusioni_in_attesa")}
            for indice, (parola, algoritmo) in enumerate(zip(parole, conteggi)):
                w, p = wik.get(parola, vuota), phon.get(parola, vuota)
                i, v = ipa.get(parola, vuota), wp.get(parola, vuota)
                record = crea_record(indice, parola, algoritmo, w, p, decisioni.get(parola), ipa=i, wikipron=v)
                audit.osserva(record)
                testo = json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n"
                files["annotazioni"].write(testo)
                if record["richiede_revisione"]:
                    coda = "revisione_prioritaria" if record["priorita_revisione"] == "prioritaria" \
                        else record["priorita_revisione"]
                    files[coda].write(testo)
                    stats["code"][coda] += 1
                    stats["revisione"][record["stato"]] += 1
                if record["esclusione_in_attesa"]:
                    files["esclusioni_in_attesa"].write(testo)
                stats["stati"][record["stato"]] += 1
                stats["stati_automatici"][record["automatico"]["stato"]] += 1
                stats["origini"][record["origine"]] += 1
                stats["copertura"]["wiktionary"] += bool(w.conteggi)
                stats["copertura"]["phonitalia"] += bool(p.conteggi)
                stats["copertura"]["entrambe"] += bool(w.conteggi and p.conteggi)
                stats["copertura"]["almeno_una"] += bool(w.conteggi or p.conteggi)
                fonti = {"wiktionary": w, "wiktionary_ipa": i, "wikipron": v, "phonitalia": p}
                presenti = [n for n, e in fonti.items() if e.conteggi]
                for nome, e in fonti.items():
                    if nome in ("wiktionary_ipa", "wikipron"):
                        stats["copertura"][nome] += bool(e.conteggi)
                    counts = stats["anomalie_per_segnale"].setdefault(nome, Counter())
                    counts.update(e.anomalie)
                stats["copertura"]["almeno_un_segnale_v2"] += bool(presenti)
                stats["copertura"]["famiglia_wiktionary"] += bool(w.conteggi or i.conteggi or v.conteggi)
                stats["copertura"]["nuove_ipa_entrambe"] += bool(i.conteggi and v.conteggi)
                stats["copertura"]["nuove_ipa_almeno_una"] += bool(i.conteggi or v.conteggi)
                stats["sovrapposizioni_segnali"]["+".join(presenti) or "nessuno"] += 1
                stats["macro_famiglie_indipendenti"][str(record["automatico"]["macro_famiglie_indipendenti"])] += 1
                stats["distribuzione_algoritmo"][str(algoritmo)] += 1
                if len(record["conteggi"]) == 1:
                    stats["distribuzione_conteggi_singoli"][str(record["conteggi"][0])] += 1
                elif len(record["conteggi"]) > 1:
                    stats["distribuzione_insiemi_multipli"][",".join(map(str, record["conteggi"]))] += 1
                else:
                    stats.setdefault("senza_conteggio_deciso", 0)
                    stats["senza_conteggio_deciso"] += 1
                esempi = stats["esempi"].setdefault(record["stato"], [])
                if len(esempi) < 5:
                    esempi.append({"parola": parola, "conteggi": record["conteggi"],
                        "algoritmo": algoritmo, "wiktionary": sorted(w.conteggi),
                        "phonitalia": sorted(p.conteggi), "wiktionary_ipa": sorted(i.conteggi),
                        "wikipron": sorted(v.conteggi), "motivo": record["automatico"]["motivo"]})
        confronto = audit.termina()
        scrivi_json(temporaneo / "confronto_prima.json", confronto)
        scrivi_json(temporaneo / "campioni_stratificati.json", audit.campioni_serializzati())
        for stato in STATI:
            stats["stati"].setdefault(stato, 0)
            stats["stati_automatici"].setdefault(stato, 0)
        stats["da_revisionare_totale"] = sum(stats["revisione"].values())
        stats["da_revisionare_prioritari"] = sum(stats["revisione"][s] for s in (
            "CONFLITTO", "DA_RIVEDERE", "AMBIGUO"))
        for coda in ("revisione_prioritaria", "stime_non_verificate", "stime_corroborate"):
            stats["code"].setdefault(coda, 0)
        stats["confronto_precedente"] = confronto["statistiche"]
        fuori = {w: d for w, d in sorted(decisioni.items()) if w not in insieme}
        stats["decisioni_fuori_vocabolario"] = len(fuori)
        scrivi_json(temporaneo / "decisioni_fuori_vocabolario.json", fuori)
        scrivi_json(temporaneo / "statistiche.json", stats)
        manifesto = {"schema_version": MANIFESTO_SCHEMA_VERSION, "politica_version": POLITICA_VERSION,
            "schemi": {"curatela": CURATELA_SCHEMA_VERSION, "annotazioni": ANNOTAZIONI_SCHEMA_VERSION,
                       "manifesto": MANIFESTO_SCHEMA_VERSION}, "parser_ipa_version": PARSER_VERSION,
            "macro_famiglie_segnali": MACRO_FAMIGLIE,
            "R1": {"tipo": "algoritmo_euristico_non_lessicale", "funzione": "conta_sillabe"},
            "creato_utc": datetime.now(timezone.utc).isoformat(), "input": input_info,
            "build_cpp": build_info,
            "compatibilita_vocabolario": {"sha256": input_info["vocabolario"]["sha256"],
                                          "grafie": len(parole)},
            "precedenza": ["curatela_ufficiale", "evidenza_concordante",
                           "stima_corroborata", "altra_evidenza_lessicale", "stima_euristica"],
            "note_fonti": {"wiktionary": "Wikizionario via Kaikki/Wiktextract, attribuzione e licenza in DATASET.md. Solo headword italiano, nessun trasferimento a flessioni. Righe JSONL 1-based.",
                "phonitalia": "PhonItalia 1.10; phonItaliaR 1.0.0 di Stefano Coretta. Copyright Jeremy Goslin, Claudia Galuzzi, Cristina Romani, come da DESCRIPTION locale. CC BY 4.0. https://stefanocoretta.github.io/phonItaliaR/ . Righe TSV 1-based, header incluso. Nessuna redistribuzione del raw."},
            "artefatti": {path.name: descrivi_file(path) for path in sorted(temporaneo.iterdir())}}
        # I percorsi temporanei degli artefatti non sono parte della provenienza.
        for nome, info in manifesto["artefatti"].items():
            info["percorso"] = nome
        for nome, path in paths.items():
            if sha256_file(path) != input_info[nome]["sha256"]:
                raise ValueError(f"Input cambiato durante l'esecuzione: {nome}")
        verifica_runner(runner)
        scrivi_json(temporaneo / "manifesto.json", manifesto)
        os.replace(temporaneo, output)
        return stats
    finally:
        audit.close()
        if temporaneo.exists():
            if temporaneo.resolve().parent != output.parent:
                raise ValueError("Directory temporanea fuori dall'area di output")
            shutil.rmtree(temporaneo)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vocabolario", type=Path, default=ROOT / "VocabolarioItaliano.txt")
    parser.add_argument("--wiktionary", type=Path, required=True)
    parser.add_argument("--phonitalia", type=Path, required=True)
    parser.add_argument("--wikipron", type=Path, required=True,
                        help="TSV broad italiano esterno al repository, SHA-256 verificato")
    parser.add_argument("--precedente", type=Path,
                        help="annotazioni.jsonl v1 per confronto e campioni stratificati")
    parser.add_argument("--runner", type=Path, required=True,
                        help="eseguibile offline compilato dai sorgenti C++ correnti")
    parser.add_argument("--curatela", type=Path,
                        default=ROOT / "tools/sillabe/curatela_ufficiale.json")
    parser.add_argument("--output", type=Path, required=True,
                        help="nuova directory esterna al repository")
    args = parser.parse_args()
    try:
        stats = esegui_pipeline(args.vocabolario, args.wiktionary, args.phonitalia,
                               args.curatela, args.runner, args.output,
                               wikipron=args.wikipron, precedente=args.precedente)
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print(f"Errore: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
