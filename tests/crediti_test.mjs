// node tests/crediti_test.mjs <root>
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verificaStoria } from "./storia_test.mjs";

export const documentiCrediti = [
    "CREDITS.md", "DATASET.md", "SILLABE_DATASET.md", "THIRD_PARTY_NOTICES.md",
    "LICENSE",
    "third_party/utf8proc/LICENSE.md", "third_party/utf8proc/README.md",
    "third_party/emscripten/README.md", "third_party/emscripten/LICENSE.txt",
    "third_party/emscripten/musl-COPYRIGHT.txt", "third_party/emscripten/libcxx-LICENSE.txt",
    "third_party/emscripten/libcxxabi-LICENSE.txt", "third_party/emscripten/compiler-rt-LICENSE.txt",
];
export const testoArca = "Rielaborazione, evoluzione e sviluppo del programma originale Anagrammi e non solo di Carlo Barabucci (2020). Conversione ed evoluzione C++, WebAssembly/PWA, interfaccia, strumenti linguistici, integrazione e curatela: Luca Montanelli, con l'ausilio di strumenti di intelligenza artificiale di OpenAI.";
export const origineArca = "http://www.pierotofy.it/pages/sorgenti/dettagli/19617-Anagrammi=CS/";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export async function verificaCrediti(root, dist = path.join(root, "dist")) {
    const html = await readFile(path.join(root, "web/index.html"), "utf8");
    const credits = html.match(/<dialog id="crediti"[\s\S]*?<\/dialog>/)[0];
    const arca = credits.match(/<section aria-labelledby="crediti-arca"[\s\S]*?<\/section>/)[0];
    const plain = value => value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    assert.equal(plain(arca.match(/<p>[\s\S]*?<\/p>/)[0]), testoArca);
    assert(arca.includes(`href="${origineArca}"`));
    assert(arca.includes("<strong>Carlo Barabucci (2020)</strong>"));
    assert(arca.includes("<strong>Luca Montanelli</strong>"));
    assert.equal(credits.match(/OpenAI/g).length, 1);
    assert.match(plain(credits), /GNU GPL versione 3 o successiva \(GPL-3\.0-or-later\)/);
    assert.doesNotMatch(plain(credits), /provvisori[ao]|in attesa di conferma|non ancora confermata|GPL-3\.0-only/i);
    assert.match(plain(credits), /CC BY-SA 4\.0/);
    assert(credits.includes('href="./LICENSE"'));
    for (const file of ["README.md", "CREDITS.md"]) {
        const notice = await readFile(path.join(root, file), "utf8");
        assert.match(notice, /GNU General Public License versione 3\s+o successiva/);
        assert.match(notice, /GPL-3\.0-or-later/);
        assert.match(notice, /Carlo Barabucci ha confermato/);
        assert.match(notice, /Luca Montanelli/);
        assert.match(notice, /CC BY-SA 4\.0/);
        assert(notice.includes("[LICENSE](LICENSE)"));
        assert.doesNotMatch(notice, /provvisori[ao]|in attesa di conferma|non ancora confermata|LICENSE GPL definitivo|GPL-3\.0-only/i);
    }
    // Git puo' convertire LF in CRLF nei clone Windows.
    const license = (await readFile(path.join(root, "LICENSE"), "utf8")).replace(/\r\n/g, "\n");
    assert.equal(Buffer.byteLength(license, "utf8"), 35149);
    assert.equal(sha(license), "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986",
        "Testo standard ufficiale GNU GPL v3, senza modifiche (LF)");
    await verificaStoria(root, dist);
    assert.equal(credits.match(/<section /g).length, 4);
    const inventory = JSON.parse(await readFile(path.join(dist, "release.json")));
    const release = path.join(dist, "releases", inventory.release_id);
    const built = await readFile(path.join(dist, "index.html"), "utf8");
    for (const file of documentiCrediti) {
        const entry = inventory.assets.find(asset => asset.path === file);
        assert(entry, file + " nel precache immutabile");
        const source = await readFile(path.join(root, file));
        assert.deepEqual(await readFile(path.join(release, file)), source, file + " byte originali");
        assert.equal(entry.sha256, sha(source));
        assert.equal(entry.size_bytes, source.length);
        if (!file.startsWith("third_party/")) assert(built.includes(`./releases/${inventory.release_id}/${file}`));
        if (file.endsWith(".md")) {
            for (const match of source.toString("utf8").matchAll(/\]\(([^)]+)\)/g)) {
                const target = match[1];
                if (/^[a-z]+:|^#/i.test(target)) continue;
                const local = path.posix.normalize(path.posix.join(path.posix.dirname(file), target));
                assert(documentiCrediti.includes(local), `${file}: link locale distribuito ${local}`);
            }
        }
    }
    const syllables = await readFile(path.join(root, "SILLABE_DATASET.md"), "utf8");
    const manifest = JSON.parse(await readFile(path.join(root, "web/data/runtime-sillabe.manifest.json")));
    for (const field of ["artifact", "artifact_sha256", "vocabolario_sha256", "annotazioni_sha256", "formato"]) {
        assert(syllables.includes(manifest[field]), field + " documentato dallo snapshot attuale");
    }
    assert.match(syllables, /TSV linguistico deriva da\s+Wiktionary, non e' dichiarato Apache 2\.0/);
    assert.match(syllables, /dataset sillabico derivato e il runtime distribuiti da ARCA sono sotto\s+\*\*\[CC BY-SA 4\.0\]/);
    assert(!inventory.assets.some(asset => asset.path.startsWith("data/runtime-sillabe") || asset.path.endsWith(".bin")));
    return { release: inventory.release_id, documents: documentiCrediti.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log("PASS crediti/attribuzioni/GPL-3.0-or-later definitiva/Storia approvata/link locali/byte licenze/precache: " +
        JSON.stringify(await verificaCrediti(path.resolve(process.argv[2]))));
}
