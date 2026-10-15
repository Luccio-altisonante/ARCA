// node tests/pwa_icone_test.mjs <root>
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const dimensioniIcone = {
    "apple-touch-icon.png": 180, "icon-16.png": 16, "icon-32.png": 32, "icon-64.png": 64,
    "icon-192.png": 192, "icon-512.png": 512, "icon-maskable-192.png": 192, "icon-maskable-512.png": 512,
};
export const nomiIcone = [...Object.keys(dimensioniIcone), "favicon.ico"].sort();
export const iconeManifest = [
    { src: "assets/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "assets/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "assets/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "assets/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

function verificaPng(bytes, size) {
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.subarray(12, 16).toString(), "IHDR");
    assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
    let offset = 8, ended = false;
    while (offset < bytes.length) {
        assert(offset + 12 <= bytes.length);
        const length = bytes.readUInt32BE(offset);
        assert(offset + length + 12 <= bytes.length);
        let crc = 0xffffffff;
        for (const byte of bytes.subarray(offset + 4, offset + 8 + length)) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        assert.equal((crc ^ 0xffffffff) >>> 0, bytes.readUInt32BE(offset + 8 + length), "CRC PNG");
        const type = bytes.subarray(offset + 4, offset + 8).toString();
        offset += length + 12;
        if (type === "IEND") { ended = true; break; }
    }
    assert(ended); assert.equal(offset, bytes.length);
}

export async function verificaIcone(root, directory = path.join(root, "dist")) {
    const source = path.join(root, "web/assets/icons");
    assert.deepEqual((await readdir(source)).sort(), nomiIcone);
    assert.deepEqual((await readdir(path.join(directory, "assets/icons"))).sort(), nomiIcone);
    const manifest = JSON.parse(await readFile(path.join(root, "web/manifest.webmanifest")));
    assert.deepEqual(manifest.icons, iconeManifest);
    assert.equal(manifest.short_name, "ARCA");
    assert.equal(manifest.name, "ARCA \u2014 Assonanze, Rime, Consonanze e Anagrammi");
    assert.equal(manifest.start_url, "./"); assert.equal(manifest.scope, "./");
    assert.equal(manifest.display, "standalone");
    assert.equal(manifest.theme_color, "#173e4b"); assert.equal(manifest.background_color, "#eef2ed");
    const inventory = JSON.parse(await readFile(path.join(directory, "release.json")));
    const release = path.join(directory, "releases", inventory.release_id);
    const publishedManifest = JSON.parse(await readFile(path.join(release, "manifest.webmanifest")));
    assert.deepEqual(publishedManifest, { ...manifest, id: "../../", start_url: "../../", scope: "../../" });
    const html = await readFile(path.join(root, "web/index.html"), "utf8");
    const publishedHtml = await readFile(path.join(directory, "index.html"), "utf8");
    for (const file of ["favicon.ico", "icon-32.png", "icon-16.png", "apple-touch-icon.png"]) {
        assert(html.includes(`href="./assets/icons/${file}"`));
        assert(publishedHtml.includes(`href="./releases/${inventory.release_id}/assets/icons/${file}"`));
        assert(!publishedHtml.includes(`href="./assets/icons/${file}"`));
    }
    const result = {};
    for (const name of nomiIcone) {
        const bytes = await readFile(path.join(source, name));
        if (name.endsWith(".png")) verificaPng(bytes, dimensioniIcone[name]);
        else {
            assert.equal(bytes.readUInt16LE(0), 0); assert.equal(bytes.readUInt16LE(2), 1);
            const count = bytes.readUInt16LE(4), sizes = [];
            assert(bytes.length >= 6 + count * 16);
            for (let i = 0; i < count; i++) {
                const offset = 6 + i * 16, width = bytes[offset] || 256, height = bytes[offset + 1] || 256;
                assert.equal(width, height);
                const start = bytes.readUInt32LE(offset + 12), length = bytes.readUInt32LE(offset + 8);
                assert(start >= 6 + count * 16 && length > 0 && start + length <= bytes.length);
                sizes.push(width);
            }
            assert.deepEqual(sizes.sort((a, b) => a - b), [16, 32, 48]);
        }
        for (const folder of [path.join(directory, "assets/icons"), path.join(release, "assets/icons")]) {
            assert.deepEqual(await readFile(path.join(folder, name)), bytes, "Byte diversi: " + name);
        }
        const entry = inventory.assets.find(asset => asset.path === "assets/icons/" + name);
        assert(entry); assert.equal(entry.sha256, sha(bytes)); assert.equal(entry.size_bytes, bytes.length);
        result[name] = { size: dimensioniIcone[name] ?? [16, 32, 48], sha256: sha(bytes) };
    }
    return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    console.log(JSON.stringify(await verificaIcone(path.resolve(process.argv[2])), null, 2));
    console.log("PASS icone ARCA: PNG/ICO, manifest/head, 9 copie dist/release identiche e precache versionato");
}
