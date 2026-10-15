// node tests/storia_test.mjs <root> [approved-package]
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
// Hash dei 26 blocchi testuali del Markdown approvato, senza markup.
const testoApprovatoSha = "cc21c17935836006538e30ae81e7ce3f8a7affb87c11527c4cef4edac75540b4";
export const paperPdf = ["papers/ordinamento_arca_paper_it.pdf", "papers/ordinamento_arca_paper_en.pdf"];
const paperSha = {
    "ordinamento_arca_paper_it.tex": "b585fd15642ed5ca88421f620896a66ae19fe9711f2a09ce95baa7c98ff8e27d",
    "ordinamento_arca_paper_it.pdf": "cbfa7f1adab41fef77839cb0e7bbc920cc91d107abe3614bfa8ff6554a87fbe8",
    "profilo_q.png": "b1fff922f0ed9129dc3aa1ce0ee613d01f0e39496c75e359909a7bb61249d31a",
    "ordinamento_arca_paper_en.tex": "4da15835185286311dfb22157a693eb8d2b1bb7451789bee68738f7a20da89e9",
    "ordinamento_arca_paper_en.pdf": "d3121dcbf51c7a76458cf3214e99e1cef1cd65c24792795e78a6519f328024b1",
    "q_profile_en.png": "c9acf55fd1e81661d1dcc878bc4c6d8811d0789569a1ae322ee2d57ba2675f12",
};
export function verificaBlocchiStoria(blocks) {
    assert.equal(blocks.length, 26);
    assert.equal(sha(blocks.join("\n\n")), testoApprovatoSha, "Testo/paragrafi identici alla Storia approvata");
    assert.equal(blocks[0], "Storia del progetto");
    assert.equal(blocks[1], "di Luca Montanelli");
    const text = blocks.join("\n");
    for (const phrase of ["ARCA nasce da un'esigenza molto concreta", "vagoni", "pivot", "Carlo Barabucci",
        "Anagrammi e non solo", "ChatGPT e Codex", "filtro sillabico", "analizzare interi testi",
        "ciò che richiede interpretazione umana"]) assert(text.includes(phrase), phrase);
    assert(!text.includes("Contenuto in preparazione."));
}
export async function verificaStoria(root, dist = path.join(root, "dist"), approvedPackage = null) {
    const html = await readFile(path.join(root, "web/index.html"), "utf8");
    const story = html.match(/<dialog id="storia"[\s\S]*?<\/dialog>/)[0];
    const blocks = [...story.matchAll(/<(h2|p|h3|li)\b[^>]*>([\s\S]*?)<\/\1>/g)]
        .map(match => match[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());
    verificaBlocchiStoria(blocks);
    assert.match(story, /aria-labelledby="titolo-storia"/);
    assert.match(story, /<section class="paper-storia" aria-labelledby="titolo-paper-storia">/);
    assert.match(story, /<form method="dialog"><button class="pulsante-secondario">Chiudi<\/button><\/form>\s*<\/dialog>$/);
    for (const pdf of paperPdf) assert(story.includes(`href="./${pdf}" target="_blank" rel="noopener"`));
    if (approvedPackage) {
        const md = await readFile(path.join(approvedPackage, "storia_progetto.md"), "utf8");
        const expected = md.trim().split(/\r?\n\s*\r?\n/)
            .flatMap(block => block.startsWith("- ") ? block.split(/\r?\n/) : [block])
            .map(block => block.replace(/^# /, "").replace(/^\*([^*]+)\*$/, (_, text) => text)
                .replace(/\*\*([^*]+)\*\*/g, (_, text) => text).replace(/\*([^*]+)\*/g, (_, text) => text)
                .replace(/^- \[([^\]]+)\]\([^)]+\)$/, (_, text) => text));
        assert.deepEqual(blocks, expected, "Confronto integrale con il Markdown esterno approvato");
    }
    for (const [file, expected] of Object.entries(paperSha)) {
        const bytes = await readFile(path.join(root, "web/papers", file));
        assert(bytes.length > 0);
        assert.equal(sha(bytes), expected, file + ": asset approvato invariato");
        if (file.endsWith(".pdf")) assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
        if (approvedPackage) assert.deepEqual(bytes, await readFile(path.join(approvedPackage, "papers", file)));
    }
    assert.notEqual(paperSha[path.basename(paperPdf[0])], paperSha[path.basename(paperPdf[1])]);
    const inventory = JSON.parse(await readFile(path.join(dist, "release.json")));
    const release = path.join(dist, "releases", inventory.release_id);
    const built = await readFile(path.join(dist, "index.html"), "utf8");
    assert.deepEqual(inventory.assets.filter(asset => asset.path.startsWith("papers/")).map(asset => asset.path).sort(), [...paperPdf].sort());
    for (const pdf of paperPdf) {
        const source = await readFile(path.join(root, "web", pdf));
        const entry = inventory.assets.find(asset => asset.path === pdf);
        assert.equal(entry.sha256, sha(source));
        assert.equal(entry.size_bytes, source.length);
        assert.deepEqual(await readFile(path.join(release, pdf)), source);
        assert(built.includes(`href="./releases/${inventory.release_id}/${pdf}"`));
        assert(!built.includes(`href="./${pdf}"`));
    }
    const worker = await readFile(path.join(dist, "service-worker.js"), "utf8");
    assert(worker.includes(JSON.stringify(inventory)), "Inventory completa iniettata nel service worker");
    return { release: inventory.release_id, blocks: blocks.length, papers: paperPdf.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    console.log("PASS Storia integrale/paper approvati/PDF immutabili/precache: " +
        JSON.stringify(await verificaStoria(path.resolve(process.argv[2]), undefined, process.argv[3])));
}
