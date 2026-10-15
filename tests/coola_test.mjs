// node tests/coola_test.mjs <root>
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function lettere(testo) {
    return [...testo.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")]
        .filter(lettera => /\p{L}/u.test(lettera)).sort().join("");
}

export function verificaCoola(data) {
    assert.equal(data?.schema, 1);
    assert(Array.isArray(data.items) && data.items.length > 0);
    for (const [index, item] of data.items.entries()) {
        assert(Array.isArray(item?.forme) && item.forme.length >= 2, `Gruppo ${index}: almeno due forme`);
        assert(item.forme.every(forma => typeof forma === "string" && forma.trim().length > 0));
        assert.equal(new Set(item.forme).size, item.forme.length, `Gruppo ${index}: duplicato identico`);
        const firma = lettere(item.forme[0]);
        assert(firma.length > 0, `Gruppo ${index}: nessuna lettera`);
        for (const forma of item.forme) assert.equal(lettere(forma), firma, `Gruppo ${index}: ${forma}`);
    }
    return data.items.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const data = JSON.parse(await readFile(path.join(process.argv[2], "web/data/coola.json"), "utf8"));
    const groups = verificaCoola(data);
    for (const invalid of [null, { schema: 2, items: [] }, { schema: 1, items: [] },
        { schema: 1, items: [{ forme: ["a"] }] }, { schema: 1, items: [{ forme: ["a", " "] }] },
        { schema: 1, items: [{ forme: ["a", 1] }] }, { schema: 1, items: [{ forme: ["a", "a"] }] },
        { schema: 1, items: [{ forme: ["a", "b"] }] }, { schema: 1, items: [{ forme: ["!", "?"] }] }]) {
        assert.throws(() => verificaCoola(invalid));
    }
    verificaCoola({ schema: 1, items: [{ forme: ["À, bi!", "i’ba"] }] });
    console.log(`PASS CoolA: ${groups} gruppi, schema/duplicati/anagrammi Unicode e fixture negative`);
}
