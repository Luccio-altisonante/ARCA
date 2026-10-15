"""Confronto streaming v1/v2 e campioni deterministici, non curatela linguistica."""

from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import unicodedata

CONTROLLI = "casa caramella paura via zio farmacia bugia regia balia viola circuito miei tuoi suoi noia aiuola fornaio poeta teatro aereo gratuito".split()


def tipologia(parola: str) -> str:
    folded = "".join(c for c in unicodedata.normalize("NFD", parola)
                     if not unicodedata.combining(c))
    if not re.fullmatch("[a-z]+", folded):
        return "segni_cifre_o_alfabeti_diversi"
    if parola != folded:
        return "accenti_scritti"
    if re.search("[aeiou]{3,}", folded):
        return "tre_vocali_adiacenti"
    if any(len(g) > 1 and any(c in "iu" for c in g) for g in re.findall("[aeiou]+", folded)):
        return "gruppi_con_i_u"
    if re.search("[aeo]{2,}", folded):
        return "vocali_forti_adiacenti"
    return "grafia_semplice_lunga" if len(parola) > 15 else "grafia_semplice"


class AuditPrecedente:
    def __init__(self, path: Path | None):
        self.stream = path.open(encoding="utf-8") if path else None
        self.transizioni = Counter()
        self.stats = Counter()
        self.benchmark = {}
        self.campioni = {}
        self.controlli = {}

    def _campione(self, gruppo: str, record: dict) -> None:
        fonti = "+".join(n for n in ("wiktionary_ipa", "wikipron") if record[n]["conteggi"]) or "nessuna_nuova"
        chiave = gruppo + ":" + tipologia(record["parola"]) + ":" + fonti
        score = hashlib.sha256(record["parola"].encode("utf-8")).hexdigest()
        campione = self.campioni.setdefault(chiave, {"popolazione": 0, "record": []})
        campione["popolazione"] += 1
        entries = campione["record"]
        if len(entries) < 8 or score < entries[-1][0]:
            entries.append((score, record))
            entries.sort(key=lambda x: x[0])
            del entries[8:]

    def osserva(self, record: dict) -> None:
        if record["parola"] in CONTROLLI:
            self.controlli[record["parola"]] = record
        if self.stream is None:
            return
        line = self.stream.readline()
        if not line:
            raise ValueError("Annotazioni precedenti piu' corte del vocabolario")
        old = json.loads(line)
        if (old.get("indice"), old.get("parola")) != (record["indice"], record["parola"]):
            raise ValueError("Annotazioni precedenti non allineate per indice e grafia")
        self.transizioni[old["stato"] + " -> " + record["stato"]] += 1
        self.stats["grafie_confrontate"] += 1
        self.stats["cambi_stato"] += old["stato"] != record["stato"]
        self.stats["cambi_R1"] += old["algoritmo"] != record["algoritmo"]
        nuove = [record[n] for n in ("wiktionary_ipa", "wikipron")]
        if old["stato"] == "SOLO_STIMA":
            self.stats["SOLO_STIMA_con_nuovo_conteggio"] += any(e["conteggi"] for e in nuove)
            self.stats["SOLO_STIMA_con_nuovo_record_anche_incompleto"] += any(e["righe"] for e in nuove)
            union = set().union(*(e["conteggi"] for e in nuove))
            candidato = union == {record["algoritmo"]} and record["algoritmo"] > 0
            self.stats["candidate_numeriche_prima_del_controllo_anomalie"] += candidato
            if candidato:
                self.stats["candidate_numeriche_" + record["stato"]] += 1
            if record["stato"] == "STIMA_CORROBORATA":
                self._campione("SOLO_corroborate", record)
            elif record["stato"] != "SOLO_STIMA":
                self._campione("SOLO_problematiche", record)
        elif old["stato"] == "RISOLTO" and record["stato"] in ("CONFLITTO", "DA_RIVEDERE"):
            self._campione("RISOLTO_nuovo_problema", record)
        w, p = old["wiktionary"]["conteggi"], old["phonitalia"]["conteggi"]
        targets = {}
        if len(w) == len(p) == 1 and w == p:
            targets["consenso_W_P_40216"] = w[0]
        if old["stato"] == "RISOLTO":
            targets["vecchi_RISOLTO"] = old["conteggi"][0]
        if old["stato"] == "DA_RIVEDERE" and len(set(w) | set(p)) == 1:
            targets["DA_RIVEDERE_con_candidato_unico"] = next(iter(set(w) | set(p)))
        for label, target in targets.items():
            stats = self.benchmark.setdefault(label, Counter())
            stats["grafie"] += 1
            stats["nuovo_stato_" + record["stato"]] += 1
            stats["conteggio_finale_univoco"] += len(record["conteggi"]) == 1
            if len(record["conteggi"]) == 1:
                stats["conteggio_finale_concordante"] += record["conteggi"][0] == target
                stats["conteggio_finale_discordante"] += record["conteggi"][0] != target
            for nome in ("wiktionary_ipa", "wikipron"):
                e = record[nome]
                stats[nome + "_copertura"] += bool(e["conteggi"])
                stats[nome + "_anomalie"] += bool(e["anomalie"])
                if len(e["conteggi"]) == 1:
                    n = e["conteggi"][0]
                    stats[nome + "_univoche"] += 1
                    stats[nome + "_concordanti"] += n == target
                    stats[nome + "_sottostime"] += n < target
                    stats[nome + "_sovrastime"] += n > target
                    stats[nome + "_regressioni_rispetto_R1"] += old["algoritmo"] == target and n != target
        if old["stato"] in ("CONFLITTO", "DA_RIVEDERE", "AMBIGUO"):
            self._campione("vecchi_" + old["stato"], record)

    def termina(self) -> dict:
        if self.stream is not None and self.stream.readline():
            raise ValueError("Annotazioni precedenti piu' lunghe del vocabolario")
        return {"tipo": "audit_automatico_non_gold", "transizioni": dict(sorted(self.transizioni.items())),
                "statistiche": dict(self.stats), "benchmark": {k: dict(v) for k, v in self.benchmark.items()},
                "controlli": self.controlli}

    def campioni_serializzati(self) -> dict:
        return {"metodo": "8 minimi SHA-256(parola) per strato; non revisione manuale",
                "strati": {k: {"popolazione": v["popolazione"], "record": [r for _, r in v["record"]]}
                           for k, v in sorted(self.campioni.items())}}

    def close(self) -> None:
        if self.stream is not None:
            self.stream.close()
