"""Prepare only the reviewer shell. Never publish or read review data."""

import argparse
import ast
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import zipfile

SOURCE = Path(__file__).resolve().parent
REPOSITORY = SOURCE.parents[1]
FILES = (
    "index.html", "style.css", "app.mjs", "reviewer-core.mjs", "db.mjs",
    "manifest.webmanifest", "service-worker.js", "icon-192.png", "icon-512.png",
)


def local_reference(value):
    if not isinstance(value, str) or not value.startswith("./") or value[2:] not in FILES:
        raise ValueError(f"Riferimento non locale o non consentito: {value!r}")


class References(HTMLParser):
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in {"script", "img"} and "src" in attrs:
            local_reference(attrs["src"])
        if tag == "link" and "href" in attrs:
            local_reference(attrs["href"])


def validate_shell(contents):
    References().feed(contents["index.html"].decode("utf-8"))
    manifest = json.loads(contents["manifest.webmanifest"])
    for field in ("id", "scope", "start_url"):
        if manifest.get(field) != "./":
            raise ValueError(f"Manifest: {field} deve essere ./")
    for icon in manifest["icons"]:
        local_reference(icon["src"])
    for name in ("app.mjs", "reviewer-core.mjs", "db.mjs"):
        for value in re.findall(r"\bfrom\s+['\"]([^'\"]+)['\"]", contents[name].decode("utf-8")):
            local_reference(value)
    worker = contents["service-worker.js"].decode("utf-8")
    match = re.search(r"const SHELL = (\[[^;]+\]);", worker)
    if not match:
        raise ValueError("Lista esplicita della shell mancante nel service worker")
    shell = ast.literal_eval(match.group(1))
    cached_assets = set(FILES) - {"service-worker.js"}
    if len(shell) != len(cached_assets) + 1 or set(shell) != {"./", *("./" + name for name in cached_assets)}:
        raise ValueError("Cache SW diversa dalla sola shell consentita")


def prepare(output, source=SOURCE, repository=REPOSITORY):
    output = Path(output).resolve()
    if output.is_relative_to(Path(repository).resolve()):
        raise ValueError("L'artefatto deve essere fuori dal repository")
    if output.exists():
        raise ValueError("Output gia' esistente: scegliere una directory nuova")
    contents = {}
    for name in FILES:
        path = Path(source) / name
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"File shell mancante o link simbolico: {name}")
        contents[name] = path.read_bytes()
    validate_shell(contents)
    site = output / "site"
    site.mkdir(parents=True)
    for name, data in contents.items():
        (site / name).write_bytes(data)
    archive = output / "revisore-shell.zip"
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in contents.items():
            z.writestr(name, data)
    with zipfile.ZipFile(archive) as z:
        if z.namelist() != list(FILES) or any(z.read(name) != contents[name] for name in FILES):
            raise ValueError("Verifica finale ZIP fallita")
    inventory = {name: {"byte": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                 for name, data in contents.items()}
    (output / "inventario-locale.json").write_text(
        json.dumps(inventory, indent=2) + "\n", encoding="utf-8")
    return archive


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="Directory nuova fuori repository")
    args = parser.parse_args()
    try:
        archive = prepare(args.output)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    print(f"Preparati {len(FILES)} file shell: {archive}")
    print("Nessun upload. Pubblicare soltanto questo ZIP o la directory site, previa autorizzazione.")


if __name__ == "__main__":
    main()
