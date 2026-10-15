import copy
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import unisci_proposte_curatela as merge


def decision(action="CONFERMA", counts=None, reason="Fixture sintetica"):
    if counts is None:
        counts = [3] if action == "CONFERMA" else [2, 3] if action == "AMBIGUO" else []
    return {"azione": action, "conteggi": counts, "autore": "Autore sintetico",
            "data": "2026-10-04", "motivazione": reason}


def document(decisions):
    return {"schema_version": 1, "tipo": "curatela_ufficiale", "decisioni": decisions}


def dump(path, value):
    path.write_bytes(merge.serializza(value))


class MergeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="merge-curatela-sintetico-")
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        self.env.update(GIT_AUTHOR_NAME="Fixture", GIT_AUTHOR_EMAIL="fixture@example.invalid",
                        GIT_COMMITTER_NAME="Fixture", GIT_COMMITTER_EMAIL="fixture@example.invalid",
                        GIT_AUTHOR_DATE="2026-10-04T10:00:00+00:00",
                        GIT_COMMITTER_DATE="2026-10-04T10:00:00+00:00")
        self.git("init", "--quiet", "--initial-branch=main")
        self.curatela = self.repo / merge.CURATELA_GIT
        self.curatela.parent.mkdir(parents=True)
        self.vocab = self.root / "vocabolario-sintetico.txt"
        self.vocab.write_bytes(b"bugia\nregia\nviola\nfalso\n")
        self.manifesto = self.root / "manifesto-sintetico.json"
        dump(self.manifesto, {"fixture": True})
        self.proposte = self.root / "proposte-sintetiche.json"
        self.base_commit = self.commit({})
        self.proposal = {"schema_version": 1, "tipo": "proposte_curatela_ufficiale",
                         "sessione_id": "sessione-sintetica",
                         "base": {"vocabolario_sha256": self.hash(self.vocab), "grafie": 4,
                                  "curatela_schema_version": 1, "curatela_sha256": self.hash(self.curatela),
                                  "curatela_revisione_git_base": self.base_commit,
                                  "annotazioni_schema_version": 2, "politica_version": "offline-v2-evidenze",
                                  "manifesto_sha256": self.hash(self.manifesto)},
                         "decisioni": [self.proposed("bugia")]}
        self.save()

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args, data=None):
        return subprocess.run(["git", "-C", str(self.repo), *args], input=data,
                              env=self.env, capture_output=True, check=True).stdout.decode().strip()

    def commit(self, decisions, parents=None, *, advance=True):
        # Solo Git plumbing in un repository temporaneo; mai add/commit nel progetto.
        raw = merge.serializza(document(decisions))
        blob = self.git("hash-object", "-w", "--stdin", data=raw)
        leaf = self.git("mktree", data=f"100644 blob {blob}\tcuratela_ufficiale.json\n".encode())
        tools = self.git("mktree", data=f"040000 tree {leaf}\tsillabe\n".encode())
        tree = self.git("mktree", data=f"040000 tree {tools}\ttools\n".encode())
        if parents is None:
            head = subprocess.run(["git", "-C", str(self.repo), "rev-parse", "--verify", "HEAD"],
                                  env=self.env, capture_output=True)
            parents = [head.stdout.decode().strip()] if head.returncode == 0 else []
        options = [v for parent in parents for v in ("-p", parent)]
        commit = self.git("commit-tree", tree, *options, data=b"Checkpoint sintetico\n")
        if advance:
            self.git("update-ref", "refs/heads/main", commit)
            self.curatela.write_bytes(raw)
        return commit

    def hash(self, path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def proposed(self, word, action="CONFERMA", counts=None, base=None, reason="Fixture sintetica"):
        return {"parola": word, **decision(action, counts, reason), "decisione_base": copy.deepcopy(base)}

    def save(self):
        dump(self.proposte, self.proposal)

    def baseline(self, decisions):
        self.base_commit = self.commit(decisions)
        self.proposal["base"].update(curatela_revisione_git_base=self.base_commit,
                                     curatela_sha256=self.hash(self.curatela))

    def analyze(self, **options):
        self.save()
        args = dict(repository=self.repo, vocabolario=self.vocab, manifesto=self.manifesto)
        args.update(options)
        return merge.analizza(self.proposte, self.curatela, **args)

    def category(self, **options):
        return self.analyze(**options)[0]["dettaglio"][0]["categoria"]

    def test_nuova_decisione_applicabile(self):
        report, candidate = self.analyze()
        self.assertEqual(report["riepilogo"]["APPLICABILE"], 1)
        self.assertEqual(candidate["decisioni"]["bugia"], decision())
        self.assertIsNone(report["curatela_candidata_sha256"])

    def test_base_identica_applicabile(self):
        old = decision(counts=[2])
        self.baseline({"bugia": old})
        self.proposal["decisioni"][0]["decisione_base"] = old
        self.assertEqual(self.category(), "APPLICABILE")

    def test_identica_idempotente(self):
        self.baseline({"bugia": decision()})
        self.proposal["decisioni"][0]["decisione_base"] = decision()
        report, candidate = self.analyze()
        self.assertEqual(report["riepilogo"]["IDEMPOTENTE"], 1)
        self.assertEqual(candidate, document({"bugia": decision()}))

    def test_ripetizione_su_candidata_con_base_null_conflitto(self):
        self.analyze()
        dump(self.curatela, document({"bugia": decision()}))
        self.assertEqual(self.category(), "CONFLITTO")

    def test_base_null_corrente_e_proposta_identiche_conflitto(self):
        current = decision()
        dump(self.curatela, document({"bugia": current}))
        report, candidate = self.analyze()
        row = report["dettaglio"][0]
        self.assertIsNone(row["decisione_base"])
        self.assertEqual(row["corrente"], row["proposta"])
        self.assertTrue(report["git"]["base_verificata"])
        self.assertEqual(row["categoria"], "CONFLITTO")
        self.assertEqual(candidate, document({"bugia": current}))

    def test_base_diversa_corrente_e_proposta_identiche_conflitto(self):
        old, current = decision(counts=[2]), decision(counts=[3])
        self.baseline({"bugia": old})
        self.proposal["decisioni"] = [self.proposed("bugia", base=old)]
        self.commit({"bugia": current})
        report, candidate = self.analyze()
        row = report["dettaglio"][0]
        self.assertEqual(row["decisione_base"], old)
        self.assertEqual(row["corrente"], row["proposta"])
        self.assertTrue(report["git"]["base_verificata"])
        self.assertEqual(report["git"]["parole_modificate"], ["bugia"])
        self.assertEqual(row["categoria"], "CONFLITTO")
        self.assertEqual(candidate, document({"bugia": current}))

    def test_base_corrente_proposta_identiche_storico_verificato_idempotente(self):
        same = decision()
        self.baseline({"bugia": same})
        self.proposal["decisioni"] = [self.proposed("bugia", base=same)]
        report, candidate = self.analyze()
        self.assertTrue(report["git"]["base_verificata"])
        self.assertTrue(report["git"]["storico_verificato"])
        self.assertEqual(report["git"]["parole_modificate"], [])
        self.assertEqual(report["dettaglio"][0]["categoria"], "IDEMPOTENTE")
        self.assertEqual(report["riepilogo"]["APPLICABILE"], 0)
        self.assertEqual(candidate, document({"bugia": same}))

    def test_base_corrente_proposta_identiche_storico_non_verificabile(self):
        same = decision()
        self.baseline({"bugia": same})
        self.proposal["decisioni"] = [self.proposed("bugia", base=same)]
        original = merge.Git.run

        def unavailable(git, *args):
            if args and args[0] == "rev-list":
                raise ValueError("Storico indisponibile fixture")
            return original(git, *args)

        with patch.object(merge.Git, "run", unavailable):
            report, candidate = self.analyze()
        self.assertTrue(report["git"]["base_verificata"])
        self.assertFalse(report["git"]["storico_verificato"])
        self.assertEqual(report["dettaglio"][0]["categoria"], "RICHIEDE_CONTROLLO_STORICO")
        self.assertEqual(report["riepilogo"]["IDEMPOTENTE"], 0)
        self.assertEqual(candidate, document({"bugia": same}))

    def test_base_corrente_proposta_identiche_storico_aba(self):
        same = decision()
        self.baseline({"bugia": same})
        self.proposal["decisioni"] = [self.proposed("bugia", base=same)]
        self.commit({"bugia": decision(counts=[4])})
        self.commit({"bugia": same})
        report, candidate = self.analyze()
        self.assertTrue(report["git"]["base_verificata"])
        self.assertTrue(report["git"]["storico_verificato"])
        self.assertEqual(report["git"]["parole_modificate"], ["bugia"])
        self.assertEqual(len(report["git"]["commit_modifiche"]["bugia"]), 2)
        self.assertEqual(report["dettaglio"][0]["categoria"], "RICHIEDE_CONTROLLO_STORICO")
        self.assertEqual(report["riepilogo"]["IDEMPOTENTE"], 0)
        self.assertEqual(candidate, document({"bugia": same}))

    def test_base_diversa_corrente_conflitto(self):
        old = decision(counts=[2])
        self.baseline({"bugia": old})
        self.proposal["decisioni"][0]["decisione_base"] = old
        dump(self.curatela, document({"bugia": decision(counts=[4])}))
        report, candidate = self.analyze()
        self.assertEqual(report["dettaglio"][0]["categoria"], "CONFLITTO")
        self.assertEqual(candidate["decisioni"]["bugia"]["conteggi"], [4])

    def test_base_null_corrente_presente_conflitto(self):
        dump(self.curatela, document({"bugia": decision(counts=[2])}))
        self.assertEqual(self.category(), "CONFLITTO")

    def test_metadati_diversi_non_idempotenti(self):
        dump(self.curatela, document({"bugia": decision(reason="Altra motivazione")}))
        self.assertEqual(self.category(), "CONFLITTO")

    def test_tutte_azioni_e_escludi_non_tocca_vocabolario(self):
        original = self.vocab.read_bytes()
        for action in ("CONFERMA", "AMBIGUO", "DA_RIVEDERE", "ESCLUDI"):
            with self.subTest(action=action):
                self.proposal["decisioni"] = [self.proposed("bugia", action)]
                report, candidate = self.analyze()
                self.assertEqual(report["dettaglio"][0]["categoria"], "APPLICABILE")
                self.assertEqual(candidate["decisioni"]["bugia"]["azione"], action)
                self.assertEqual(self.vocab.read_bytes(), original)

    def test_conteggi_booleani_non_ordinati_duplicati_e_cardinalita(self):
        for action, values in (("CONFERMA", [True]), ("CONFERMA", [0]), ("CONFERMA", [2.0]),
                               ("AMBIGUO", [3, 2]), ("AMBIGUO", [2, 2]), ("CONFERMA", []),
                               ("AMBIGUO", [2]), ("ESCLUDI", [2]), ("DA_RIVEDERE", [2]),
                               ("CONFERMA", [1000001])):
            with self.subTest(action=action, values=values):
                self.proposal["decisioni"] = [self.proposed("bugia", action, values)]
                report, candidate = self.analyze()
                self.assertEqual(report["dettaglio"][0]["categoria"], "RICHIEDE_CONTROLLO")
                self.assertEqual(candidate["decisioni"], {})

    def test_duplicati_per_parola_rifiutati(self):
        self.proposal["decisioni"].append(copy.deepcopy(self.proposal["decisioni"][0]))
        with self.assertRaisesRegex(ValueError, "duplicata"):
            self.analyze()

    def test_parola_non_canonica_o_sconosciuta(self):
        for word in ("BUGIA", " bugia", "bu gia", "bu\x00gia", "citta\u0300", "inesistente"):
            with self.subTest(word=word):
                self.proposal["decisioni"] = [self.proposed(word)]
                self.assertEqual(self.category(), "PAROLA_NON_VALIDA")

    def test_nfc_accenti_apostrofi_preservati(self):
        self.vocab.write_text("citt\u00e0\nl'acqua\n", encoding="utf-8")
        self.proposal["base"].update(vocabolario_sha256=self.hash(self.vocab), grafie=2)
        self.proposal["decisioni"] = [self.proposed("citt\u00e0"), self.proposed("l'acqua")]
        report, candidate = self.analyze()
        self.assertEqual(report["riepilogo"]["APPLICABILE"], 2)
        self.assertEqual(set(candidate["decisioni"]), {"citt\u00e0", "l'acqua"})

    def test_base_versioni_hash_grafie_incompatibili(self):
        original = copy.deepcopy(self.proposal["base"])
        for key, value in (("vocabolario_sha256", "0" * 64), ("grafie", 5), ("grafie", True),
                           ("curatela_schema_version", True), ("annotazioni_schema_version", 1),
                           ("politica_version", "vecchia"), ("manifesto_sha256", "0" * 64)):
            with self.subTest(key=key):
                self.proposal["base"] = copy.deepcopy(original)
                self.proposal["base"][key] = value
                self.assertEqual(self.category(), "BASE_INCOMPATIBILE")

    def test_commit_inesistente(self):
        self.proposal["base"]["curatela_revisione_git_base"] = "0" * 40
        self.assertEqual(self.category(), "BASE_INCOMPATIBILE")

    def test_commit_non_antenato(self):
        other = self.commit({"viola": decision()}, parents=[], advance=False)
        self.proposal["base"]["curatela_revisione_git_base"] = other
        self.assertEqual(self.category(), "BASE_INCOMPATIBILE")

    def test_commit_tipo_blob_rifiutato(self):
        self.proposal["base"]["curatela_revisione_git_base"] = self.git("hash-object", "-w", "--stdin", data=b"fixture")
        self.assertEqual(self.category(), "BASE_INCOMPATIBILE")

    def test_hash_curatela_al_commit_errato(self):
        self.proposal["base"]["curatela_sha256"] = "0" * 64
        report, candidate = self.analyze()
        self.assertIn("Hash curatela al commit base diverso", report["problemi_base"])
        self.assertEqual(candidate["decisioni"], {})

    def test_base_della_parola_falsa(self):
        self.proposal["decisioni"][0]["decisione_base"] = decision(counts=[2])
        self.assertEqual(self.category(), "BASE_INCOMPATIBILE")

    def test_git_assente_non_presume_assenza_aba(self):
        self.proposal["base"]["curatela_revisione_git_base"] = None
        self.assertEqual(self.category(), "RICHIEDE_CONTROLLO_STORICO")

    def test_git_assente_hash_corrente_diverso(self):
        self.proposal["base"]["curatela_revisione_git_base"] = None
        dump(self.curatela, document({"viola": decision()}))
        self.assertEqual(self.category(), "BASE_INCOMPATIBILE")

    def test_vocabolario_non_fornito_blocca_applicazione(self):
        report, candidate = self.analyze(vocabolario=None)
        self.assertEqual(report["dettaglio"][0]["categoria"], "RICHIEDE_CONTROLLO")
        self.assertEqual(candidate["decisioni"], {})

    def test_manifesto_opzionale(self):
        self.assertEqual(self.category(manifesto=None), "APPLICABILE")

    def test_aba(self):
        old = decision(counts=[2])
        self.baseline({"bugia": old})
        self.proposal["decisioni"][0]["decisione_base"] = old
        self.commit({"bugia": decision(counts=[4])})
        self.commit({"bugia": old})
        report, candidate = self.analyze()
        self.assertEqual(report["dettaglio"][0]["categoria"], "RICHIEDE_CONTROLLO_STORICO")
        self.assertEqual(report["git"]["parole_modificate"], ["bugia"])
        self.assertEqual(len(report["git"]["commit_modifiche"]["bugia"]), 2)
        self.assertEqual(candidate["decisioni"]["bugia"], old)

    def test_aba_absente_presente_assente(self):
        self.commit({"bugia": decision(counts=[4])})
        self.commit({})
        self.assertEqual(self.category(), "RICHIEDE_CONTROLLO_STORICO")

    def test_modifica_committata_diversa_e_conflitto(self):
        self.commit({"bugia": decision(counts=[4])})
        report, candidate = self.analyze()
        self.assertEqual(report["dettaglio"][0]["categoria"], "CONFLITTO")
        self.assertEqual(report["git"]["parole_modificate"], ["bugia"])
        self.assertEqual(candidate["decisioni"]["bugia"]["conteggi"], [4])

    def test_identica_corrente_con_base_null_committata_conflitto(self):
        self.commit({"bugia": decision()})
        report, candidate = self.analyze()
        self.assertEqual(report["dettaglio"][0]["categoria"], "CONFLITTO")
        self.assertEqual(candidate, document({"bugia": decision()}))

    def test_aba_su_ramo_merge(self):
        side = self.commit({"bugia": decision(counts=[4])}, parents=[self.base_commit], advance=False)
        back = self.commit({}, parents=[side], advance=False)
        main = self.commit({"viola": decision()})
        self.commit({"viola": decision()}, parents=[main, back])
        self.assertEqual(self.category(), "RICHIEDE_CONTROLLO_STORICO")

    def test_modifica_altra_parola_non_blocca(self):
        self.commit({"viola": decision()})
        report, candidate = self.analyze()
        self.assertEqual(report["riepilogo"]["APPLICABILE"], 1)
        self.assertEqual(set(candidate["decisioni"]), {"viola", "bugia"})

    def test_storico_incompleto_blocca(self):
        original = merge.Git.run

        def shallow(git, *args):
            return b"true\n" if args == ("rev-parse", "--is-shallow-repository") else original(git, *args)

        with patch.object(merge.Git, "run", shallow):
            self.assertEqual(self.category(), "RICHIEDE_CONTROLLO_STORICO")

    def test_storico_non_validabile_blocca(self):
        original = merge.Git.run

        def unavailable(git, *args):
            if args and args[0] == "rev-list":
                raise ValueError("Storico indisponibile fixture")
            return original(git, *args)

        with patch.object(merge.Git, "run", unavailable):
            self.assertEqual(self.category(), "RICHIEDE_CONTROLLO_STORICO")

    def test_snapshot_storico_malformato_blocca(self):
        self.commit({"bugia": decision(counts=[True])})
        self.commit({})
        self.assertEqual(self.category(), "RICHIEDE_CONTROLLO_STORICO")

    def test_replace_git_blocca(self):
        other = self.commit({"viola": decision()}, parents=[self.base_commit], advance=False)
        self.git("replace", self.base_commit, other)
        self.assertEqual(self.category(), "RICHIEDE_CONTROLLO_STORICO")

    def test_output_solo_esterno_e_nessun_input_modificato(self):
        before = {p: p.read_bytes() for p in (self.proposte, self.curatela, self.vocab, self.manifesto)}
        head = self.git("rev-parse", "HEAD")
        report_file, candidate_file = self.root / "rapporto.json", self.root / "candidata.json"
        report = merge.esegui(self.proposte, self.curatela, report_file, candidata=candidate_file,
                             repository=self.repo, vocabolario=self.vocab, manifesto=self.manifesto)
        self.assertEqual(report["curatela_candidata_sha256"], self.hash(candidate_file))
        self.assertEqual(json.loads(report_file.read_text(encoding="utf-8")), report)
        self.assertEqual(before, {p: p.read_bytes() for p in before})
        self.assertEqual(head, self.git("rev-parse", "HEAD"))

    def test_output_in_repository_reale_o_sintetico_rifiutato(self):
        for output in (self.repo / "vietato.json", merge.ROOT / "vietato.json", self.curatela):
            with self.subTest(output=str(output)), self.assertRaisesRegex(ValueError, "fuori repository"):
                merge.esegui(self.proposte, self.curatela, output, repository=self.repo)
        self.assertFalse((merge.ROOT / "vietato.json").exists())

    def test_candidate_in_repository_rifiutata_prima_di_scrivere_report(self):
        output = self.root / "rapporto.json"
        with self.assertRaisesRegex(ValueError, "fuori repository"):
            merge.esegui(self.proposte, self.curatela, output, candidata=self.curatela, repository=self.repo)
        self.assertFalse(output.exists())

    def test_repository_sottocartella_non_elude_confini(self):
        output = self.repo / "vietato.json"
        with self.assertRaisesRegex(ValueError, "fuori repository"):
            merge.esegui(self.proposte, self.curatela, output, repository=self.curatela.parent)
        self.assertFalse(output.exists())

    def test_collisione_output_concorrente_non_sovrascrive(self):
        original = merge.analizza
        candidate, report_file = self.root / "candidata.json", self.root / "report.json"

        def race(*args, **kwargs):
            result = original(*args, **kwargs)
            candidate.write_bytes(b"ALTRO PROCESSO")
            return result

        with patch.object(merge, "analizza", race), self.assertRaises(FileExistsError):
            merge.esegui(self.proposte, self.curatela, report_file, candidata=candidate,
                         repository=self.repo, vocabolario=self.vocab)
        self.assertEqual(candidate.read_bytes(), b"ALTRO PROCESSO")
        self.assertFalse(report_file.exists())

    def test_symlink_output_in_repository_rifiutato(self):
        link = self.root / "link-esterno"
        try:
            link.symlink_to(self.repo, target_is_directory=True)
        except OSError as exc:
            self.skipTest("Symlink non consentiti nell'ambiente: " + str(exc))
        with self.assertRaisesRegex(ValueError, "fuori repository"):
            merge.esegui(self.proposte, self.curatela, link / "vietato.json", repository=self.repo)
        self.assertFalse((self.repo / "vietato.json").exists())

    def test_output_esistente_non_sovrascritto(self):
        output = self.root / "esistente.json"
        output.write_bytes(b"ORIGINALE")
        for report, candidate in ((output, None), (self.root / "report.json", output)):
            with self.subTest(report=str(report)), self.assertRaisesRegex(ValueError, "esistente"):
                merge.esegui(self.proposte, self.curatela, report, candidata=candidate, repository=self.repo)
        self.assertEqual(output.read_bytes(), b"ORIGINALE")
        self.assertFalse((self.root / "report.json").exists())

    def test_stesso_output_e_input_rifiutati(self):
        with self.assertRaises(ValueError):
            merge.esegui(self.proposte, self.curatela, self.proposte, repository=self.repo)
        with self.assertRaises(ValueError):
            merge.esegui(self.proposte, self.curatela, self.root / "x.json", candidata=self.root / "x.json", repository=self.repo)

    def test_dry_run_scrive_solo_report(self):
        output = self.root / "dry-run.json"
        before = self.curatela.read_bytes()
        report = merge.esegui(self.proposte, self.curatela, output, repository=self.repo, vocabolario=self.vocab)
        self.assertIsNone(report["curatela_candidata_sha256"])
        self.assertEqual(before, self.curatela.read_bytes())
        self.assertFalse((self.root / "curatela_candidata.json").exists())

    def test_determinismo_indipendente_ordine_input(self):
        self.proposal["decisioni"].append(self.proposed("regia", "AMBIGUO"))
        first_report, first_candidate = self.analyze()
        self.proposal["decisioni"].reverse()
        second_report, second_candidate = self.analyze()
        self.assertEqual(merge.serializza(first_candidate), merge.serializza(second_candidate))
        self.assertEqual(first_report["dettaglio"], second_report["dettaglio"])
        self.assertNotEqual(first_report["proposte_sha256"], second_report["proposte_sha256"])
        third_report, third_candidate = self.analyze()
        self.assertEqual(merge.serializza(second_report), merge.serializza(third_report))
        self.assertEqual(second_candidate, third_candidate)

    def test_candidata_esclude_solo_bloccati(self):
        self.proposal["decisioni"].append(self.proposed("regia", "ESCLUDI"))
        dump(self.curatela, document({"bugia": decision(counts=[4]), "viola": decision()}))
        report, candidate = self.analyze()
        self.assertEqual(report["riepilogo"]["APPLICABILE"], 1)
        self.assertEqual(report["riepilogo"]["CONFLITTO"], 1)
        self.assertEqual(candidate["decisioni"]["bugia"]["conteggi"], [4])
        self.assertEqual(candidate["decisioni"]["regia"]["azione"], "ESCLUDI")
        self.assertIn("viola", candidate["decisioni"])

    def test_schema_vecchio_campi_extra_e_base_mancante(self):
        original = copy.deepcopy(self.proposal)
        for change in (lambda p: p.update(schema_version=True), lambda p: p.update(schema_version=2),
                       lambda p: p.update(indice=3), lambda p: p["decisioni"][0].pop("decisione_base")):
            self.proposal = copy.deepcopy(original)
            change(self.proposal)
            with self.assertRaises(ValueError):
                self.analyze()

    def test_json_chiavi_duplicate_e_nan_rifiutati(self):
        for raw in (b'{"schema_version":1,"schema_version":1}', b'{"numero":NaN}'):
            self.proposte.write_bytes(raw)
            with self.assertRaises(ValueError):
                merge.analizza(self.proposte, self.curatela, repository=self.repo)

    def test_input_cambiato_durante_analisi_rifiutato(self):
        original = merge.verifica_git

        def mutate(*args):
            result = original(*args)
            self.proposte.write_bytes(self.proposte.read_bytes() + b" ")
            return result

        with patch.object(merge, "verifica_git", mutate), self.assertRaisesRegex(ValueError, "Input cambiato"):
            self.analyze()

    def test_head_cambiata_durante_analisi_rifiutata(self):
        original = merge.verifica_git

        def change_head(*args):
            result = original(*args)
            self.commit({"viola": decision()})
            return result

        with patch.object(merge, "verifica_git", change_head), self.assertRaises(ValueError):
            self.analyze()

    def test_cli_dry_run_e_exit_code_bloccati(self):
        report = self.root / "cli-report.json"
        result = subprocess.run([sys.executable, "-B", str(merge.ROOT / "tools/unisci_proposte_curatela.py"),
                                 "--proposte", str(self.proposte), "--curatela", str(self.curatela),
                                 "--repository", str(self.repo), "--vocabolario", str(self.vocab),
                                 "--report", str(report)], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertIsNone(json.loads(report.read_text())["curatela_candidata_sha256"])
        self.proposal["base"]["curatela_revisione_git_base"] = None
        self.save()
        result = subprocess.run([sys.executable, "-B", str(merge.ROOT / "tools/unisci_proposte_curatela.py"),
                                 "--proposte", str(self.proposte), "--curatela", str(self.curatela),
                                 "--repository", str(self.repo), "--report", str(self.root / "cli-blocked.json")], capture_output=True)
        self.assertEqual(result.returncode, 1)


if __name__ == "__main__":
    unittest.main()
