"""Parser IPA offline conservativo: nessuna regola specifica per singole parole."""

from dataclasses import dataclass, field
import re
import unicodedata

VOWELS = set("aeiouy\u025b\u0254\u00e6\u0251\u0250\u0252\u025c\u025e\u0259\u0258"
             "\u0264\u0275\u00f8\u0153\u0276\u026a\u028a\u028c\u026f\u0268\u0289\u028f\u025a")
CONSONANTS = set("bcdfghjklmnpqrstvwxyz\u0261\u0283\u0292\u0272\u028e\u014b\u027e\u0271"
                 "\u0281\u0280\u0279\u026b\u028b\u025f\u0294\u0255\u03b8\u03b2\u00f0"
                 "\u029d\u0263\u0282\u0290\u0273\u026d\u0288\u0256\u0291\u0257\u0253"
                 "\u0274\u0284\u028d\u0278\u0295\u0127\u028c\u02a4\u02a7\u026c\u026e") - VOWELS
STRESS = "\u02c8\u02cc"
NON_SYLLABIC = "\u032f"
SYLLABIC = "\u0329"
TIES = "\u0361\u035c"
MODIFIERS = ":\u02d0\u02d1\u02b0\u02b2\u02b7\u02b3\u02de\u02e0\u02e4"
DIACRITICS = set("\u0303\u032a\u031a\u033a\u031e\u031d\u0325\u032c\u0324\u0330"
                 "\u0339\u031c\u031f\u0320\u0308\u0334\u0318\u0319")
WEAK = set("iu\u026a\u028a")
PARSER_VERSION = "ipa-v2-conservativo-2"


@dataclass
class AnalisiIPA:
    conteggi: set[int] = field(default_factory=set)
    anomalie: set[str] = field(default_factory=set)
    testimoni: dict[int, str] = field(default_factory=dict)


def _conteggio(ipa: str) -> tuple[int | None, set[str]]:
    text = unicodedata.normalize("NFD", ipa.strip())
    segments = []
    anomalies = set()
    stressed = False
    boundary = True
    tie = False
    last = None
    for char in text:
        if char.isspace():
            continue  # A phoneme separator is not a syllable boundary.
        if char in STRESS:
            if stressed:
                return None, {"accenti_ipa_consecutivi"}
            stressed = True
        elif char in ".\u00b7\u2027":
            if boundary or stressed or tie:
                return None, {"confine_ipa_malformato"}
            boundary = True
            last = None
        elif char in VOWELS or char in CONSONANTS:
            vowel = char in VOWELS
            if tie and (vowel or last is None or last["vocale"]):
                return None, {"legatura_ipa_non_interpretabile"}
            last = {"simbolo": char, "vocale": vowel, "sillabico": vowel,
                    "tonico": stressed, "confine": boundary, "marcato": False}
            segments.append(last)
            if vowel:
                stressed = False
            boundary = False
            tie = False
        elif char in (NON_SYLLABIC, SYLLABIC):
            if last is None or last["marcato"]:
                return None, {"diacritico_sillabico_malformato"}
            if char == NON_SYLLABIC and (not last["vocale"] or last["tonico"]):
                return None, {"vocale_non_sillabica_incompatibile"}
            last["sillabico"] = char == SYLLABIC
            last["marcato"] = True
            if char == SYLLABIC:
                stressed = False
        elif char in TIES:
            if last is None or tie:
                return None, {"legatura_ipa_malformata"}
            tie = True
        elif char in MODIFIERS or char in DIACRITICS:
            if last is None:
                return None, {"diacritico_ipa_senza_segmento"}
        else:
            return None, {"simbolo_ipa_non_supportato"}
    if stressed or tie or boundary:
        return None, {"trascrizione_ipa_incompleta"}
    for previous, current in zip(segments, segments[1:]):
        if current["confine"] or not (previous["vocale"] and current["vocale"]):
            continue
        if previous["sillabico"] and current["sillabico"] and any(
                s["simbolo"] in WEAK and not s["tonico"] and not s["marcato"]
                for s in (previous, current)):
            anomalies.add("vocali_adiacenti_non_disambiguate")
    count = sum(s["sillabico"] for s in segments)
    if not count:
        return None, {"ipa_senza_nuclei"}
    return count, anomalies


def analizza_ipa(testo: object, *, segmentato: bool = False) -> AnalisiIPA:
    """Preserva alternative e candidati incerti, senza espandere elementi opzionali."""
    result = AnalisiIPA()
    if not isinstance(testo, str) or not testo.strip():
        result.anomalie.add("ipa_vuoto_o_non_stringa")
        return result
    text = testo.strip()
    if any(c in text for c in "(){}"):
        result.anomalie.add("elementi_ipa_opzionali_o_editoriali")
        return result
    if segmentato and any(c in text for c in "/[];,\n\r"):
        result.anomalie.add("riga_ipa_segmentata_malformata")
        return result
    if any(c in text for c in "/[]"):
        matches = list(re.finditer(r"/([^/\[\]]+)/|\[([^/\[\]]+)\]", text))
        remainder = re.sub(r"/([^/\[\]]+)/|\[([^/\[\]]+)\]", "", text)
        if not matches or not re.fullmatch(r"[\s,;]*", remainder):
            result.anomalie.add("delimitatori_ipa_malformati")
            return result
        alternatives = [m.group(1) or m.group(2) for m in matches]
    else:
        alternatives = re.split(r"[,;]", text) if not segmentato else [text]
    for ipa in alternatives:
        count, anomalies = _conteggio(ipa)
        result.anomalie.update(anomalies)
        if count is not None:
            result.conteggi.add(count)
            result.testimoni.setdefault(count, ipa.strip())
    return result
