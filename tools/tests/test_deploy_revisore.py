import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

MODULE = Path(__file__).resolve().parents[1] / "revisore_sillabe" / "prepara_deploy.py"
spec = importlib.util.spec_from_file_location("deploy_revisore", MODULE)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.source = self.repo / "tools" / "revisore_sillabe"
        self.source.mkdir(parents=True)
        for name in deploy.FILES:
            shutil.copyfile(deploy.SOURCE / name, self.source / name)
        self.output = self.root / "output"

    def build(self):
        return deploy.prepare(self.output, self.source, self.repo)

    def test_only_shell_byte_identical_no_data_or_docs(self):
        private = b'{"record":[{"parola":"segreto-test123"}],"decisioni":[]}'
        for name in ("pacchetto.json", "proposte.json", "VocabolarioItaliano.txt", "README.md"):
            (self.source / name).write_bytes(private)
        before = {name: (self.source / name).read_bytes() for name in deploy.FILES}
        archive = self.build()
        self.assertEqual({p.name for p in (self.output / "site").iterdir()}, set(deploy.FILES))
        with zipfile.ZipFile(archive) as z:
            self.assertEqual(z.namelist(), list(deploy.FILES))
            for name in deploy.FILES:
                self.assertEqual(z.read(name), before[name])
                self.assertNotIn(b"segreto-test123", z.read(name))
                self.assertEqual((self.source / name).read_bytes(), before[name])
        inventory = json.loads((self.output / "inventario-locale.json").read_text())
        self.assertEqual(set(inventory), set(deploy.FILES))

    def test_output_inside_repo_refused(self):
        with self.assertRaisesRegex(ValueError, "fuori"):
            deploy.prepare(self.repo / "output", self.source, self.repo)

    def test_existing_output_untouched(self):
        self.output.mkdir()
        sentinel = self.output / "non-toccare.txt"
        sentinel.write_text("intatto")
        with self.assertRaisesRegex(ValueError, "esistente"):
            self.build()
        self.assertEqual(sentinel.read_text(), "intatto")

    def test_missing_file_refused_before_output(self):
        (self.source / "db.mjs").unlink()
        with self.assertRaisesRegex(ValueError, "mancante"):
            self.build()
        self.assertFalse(self.output.exists())

    def test_absolute_asset_url_refused(self):
        path = self.source / "index.html"
        path.write_text(path.read_text(encoding="utf-8").replace('./app.mjs', '/app.mjs'), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Riferimento"):
            self.build()

    def test_absolute_manifest_scope_refused(self):
        path = self.source / "manifest.webmanifest"
        manifest = json.loads(path.read_text())
        manifest["scope"] = "/"
        path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "scope"):
            self.build()

    def test_dataset_in_cache_refused(self):
        path = self.source / "service-worker.js"
        path.write_text(path.read_text(encoding="utf-8").replace("'./db.mjs'", "'./pacchetto.json'"), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Cache SW"):
            self.build()


if __name__ == "__main__":
    unittest.main()
