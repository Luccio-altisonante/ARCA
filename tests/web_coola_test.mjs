// node tests/web_coola_test.mjs <root> <playwright-module> [external-output-directory]
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verificaCoola } from "./coola_test.mjs";

const root = path.resolve(process.argv[2]);
const out = process.argv[4] ? path.resolve(process.argv[4]) : await mkdtemp(path.join(os.tmpdir(), "arca-coola-"));
const relative = path.relative(root, out);
assert(relative && (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)));
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(process.argv[3]));
const bytes = await readFile(path.join(root, "web/data/coola.json"));
const data = JSON.parse(bytes);
verificaCoola(data);
const source = (await readFile(path.join(root, "web/index.html"), "utf8"))
    .replace('<script type="module" src="./app.js"></script>', "");
const inventory = JSON.parse(await readFile(path.join(root, "dist/release.json")));
const entry = inventory.assets.find(asset => asset.path === "data/coola.json");
assert(entry);
assert.equal(entry.size_bytes, bytes.length);
assert.equal(entry.sha256, createHash("sha256").update(bytes).digest("hex"));
assert.deepEqual(await readFile(path.join(root, "dist/releases", inventory.release_id, entry.path)), bytes);
const report = { checks: [], errors: [], release: inventory.release_id, groups: data.items.length };
const requests = [];
let plan = { status: 200, body: bytes };
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
    ".wasm": "application/wasm", ".json": "application/json", ".webmanifest": "application/manifest+json",
    ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };
const server = createServer(async (request, response) => {
    try {
        const url = new URL(request.url, "http://localhost");
        requests.push(url.pathname);
        if (url.pathname === "/sviluppo/data/coola.json") {
            response.writeHead(plan.status, { "Content-Type": "application/json" }).end(plan.body);
            return;
        }
        if (url.pathname === "/sviluppo/") {
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(source);
            return;
        }
        const prefix = url.pathname.startsWith("/arca/") ? "/arca/" : "/sviluppo/";
        assert(url.pathname.startsWith(prefix));
        const base = path.join(root, prefix === "/arca/" ? "dist" : "web");
        const file = path.resolve(base, decodeURIComponent(url.pathname.slice(prefix.length)) || "index.html");
        assert(file.startsWith(base + path.sep));
        response.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
        response.end(await readFile(file));
    } catch (error) { report.errors.push("HTTP: " + error.message); response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PWA_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
report.browser = browser.version();
report.url = origin + "/arca/";
let expectedFailure = false, offline = false;
async function open(url) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(() => {
        window.__rejections = [];
        window.__coolaClose = 0;
        addEventListener("unhandledrejection", event => window.__rejections.push(String(event.reason)));
        const add = EventTarget.prototype.addEventListener;
        EventTarget.prototype.addEventListener = function (name, listener, options) {
            if (this instanceof HTMLDialogElement && this.id === "coola" && name === "close") {
                return add.call(this, name, function (event) { window.__coolaClose++; listener.call(this, event); }, options);
            }
            return add.call(this, name, listener, options);
        };
    });
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    page.on("console", message => {
        if (message.type() === "error" && !(expectedFailure && /Failed to load resource/.test(message.text())) &&
            !(offline && /net::ERR_INTERNET_DISCONNECTED/.test(message.text()))) report.errors.push(message.text());
    });
    page.on("response", response => {
        if (response.status() >= 400 && !(expectedFailure && response.url().endsWith("/data/coola.json"))) report.errors.push(response.status() + ": " + response.url());
    });
    await context.route("**/*", route => {
        if (new URL(route.request().url()).origin !== origin) {
            report.errors.push("Richiesta terza inattesa: " + route.request().url()); return route.abort();
        }
        return route.continue();
    });
    await page.goto(url);
    await page.locator('[data-guida="anagrammi"]').click();
    await page.locator('[data-guida="anagrammi"]').click();
    return { context, page };
}
const loaded = page => page.waitForFunction(() => document.querySelector("#stato-coola").hidden);
const returned = page => page.waitForFunction(() => !document.querySelector("#coola").open && document.activeElement === document.querySelector("#apri-coola"));
async function content(page, expected = data.items.map(item => item.forme)) {
    assert.deepEqual(await page.locator(".coola-gruppo").evaluateAll(groups => groups.map(group =>
        [...group.querySelectorAll(".coola-forma")].map(form => form.textContent))), expected);
    assert.equal(await page.locator(".coola-scambio").count(), expected.reduce((n, forms) => n + forms.length - 1, 0));
    assert(await page.evaluate(() => {
        const dialog = document.querySelector("#coola"), box = dialog.getBoundingClientRect();
        return document.documentElement.scrollWidth <= innerWidth && box.left >= 0 && box.right <= innerWidth &&
            box.top >= 0 && box.bottom <= innerHeight && dialog.scrollWidth <= dialog.clientWidth &&
            [...dialog.querySelectorAll(".coola-gruppo, .coola-forma")].every(element => element.scrollWidth <= element.clientWidth + 1);
    }));
    const instagram = page.locator("#coola .coola-suggerimenti a");
    for (const link of [instagram, page.locator(".footer-sito a")]) {
        assert.equal(await link.getAttribute("href"), "https://www.instagram.com/luca__montanelli/");
        assert.equal(await link.innerText(), "@luca__montanelli");
        assert.equal(await link.getAttribute("target"), "_blank");
        assert.equal(await link.getAttribute("rel"), "noopener noreferrer");
    }
    assert.deepEqual(await page.evaluate(() => window.__rejections), []);
}
try {
    for (const mode of ["sviluppo", "arca"]) {
        const { context, page } = await open(origin + "/" + mode + "/");
        if (mode === "arca") await page.waitForFunction(() => document.querySelector("#stato-sillabe").textContent.includes("Filtro sillabico disponibile"), null, { timeout: 120000 });
        const before = requests.filter(url => url.endsWith("/data/coola.json")).length;
        for (const [width, height] of [[1440, 1000], [390, 844], [320, 740]]) {
            await page.setViewportSize({ width, height });
            assert.deepEqual(await page.locator("#navigazione a").allTextContents(), ["Home", "Storia del progetto", "Crediti e licenze"]);
            assert(await page.evaluate(() => document.querySelector("#app").lastElementChild.id === "apri-coola" &&
                document.querySelector("#apri-coola").previousElementSibling.classList.contains("dettagli-tecnici") &&
                document.querySelector("#app").nextElementSibling.matches(".footer-sito")));
            assert.match(await page.locator(".footer-sito").innerText(), /ARCA · Luca Montanelli · Instagram @luca__montanelli/);
            const trigger = page.getByRole("button", { name: "CoolA Scopri la raccolta", exact: true });
            await trigger.scrollIntoViewIfNeeded();
            assert(await trigger.isVisible());
            await page.screenshot({ path: path.join(out, `home-${mode}-${width}.png`) });
            await page.locator(".dettagli-tecnici summary").focus();
            await page.keyboard.press("Tab");
            assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
            assert.notEqual(await trigger.evaluate(element => getComputedStyle(element).outlineStyle), "none");
            for (const key of ["Enter", "Space", null]) {
                const previous = await page.evaluate(() => window.__coolaClose);
                if (key) await page.keyboard.press(key); else await trigger.click();
                assert(await page.locator("#coola").evaluate(dialog => dialog.open));
                await loaded(page); await content(page);
                if (key === "Enter") await page.screenshot({ path: path.join(out, `coola-${mode}-${width}.png`) });
                if (key === "Space") await page.locator("#coola button").click(); else await page.keyboard.press("Escape");
                await returned(page);
                await page.waitForFunction(expected => window.__coolaClose === expected, previous + 1);
                assert.equal(await page.evaluate(() => window.__coolaClose), previous + 1);
            }
            report.checks.push(`${mode} ${width}x${height}: pannello/footer, Enter/Space/click, dati, layout, Escape/Chiudi e focus/listener one-shot`);
            await page.locator(".footer-sito").scrollIntoViewIfNeeded();
            assert(await page.locator(".footer-sito").isVisible());
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            await page.screenshot({ path: path.join(out, `footer-${mode}-${width}.png`) });
        }
        if (mode === "sviluppo") assert.equal(requests.filter(url => url.endsWith("/data/coola.json")).length, before + 1);
        if (mode === "arca") {
            const worker = await page.evaluate(async () => {
                const worker = (await navigator.serviceWorker.ready).active;
                if (worker.state !== "activated") await new Promise(resolve => worker.addEventListener("statechange", () => { if (worker.state === "activated") resolve(); }));
                return worker.state;
            });
            assert.equal(worker, "activated");
            const cacheName = "anagrammi-app-release-" + inventory.release_id;
            const jsonUrl = origin + `/arca/releases/${inventory.release_id}/data/coola.json`;
            assert(await page.evaluate(async ({ name, url }) => Boolean(await (await caches.open(name)).match(url)), { name: cacheName, url: jsonUrl }));
            await page.reload();
            await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
            await context.setOffline(true); offline = true;
            await page.reload();
            await page.waitForFunction(() => document.querySelector("#stato-sillabe").textContent.includes("offline"), null, { timeout: 120000 });
            await page.locator("#apri-coola").click(); await loaded(page); await content(page);
            const response = await page.evaluate(async url => {
                const response = await fetch(url); return { status: response.status, bytes: [...new Uint8Array(await response.arrayBuffer())] };
            }, jsonUrl);
            assert.equal(response.status, 200); assert.deepEqual(Buffer.from(response.bytes), bytes);
            await page.keyboard.press("Escape"); await returned(page);
            report.checks.push("Offline: nuova apertura dopo reload, JSON HTTP 200/byte originali dalla cache immutabile, runtime ancora disponibile offline");
            offline = false;
        }
        await context.close();
    }
    expectedFailure = true;
    for (const invalid of ["{", JSON.stringify(null), JSON.stringify({ schema: 2, items: [] }),
        JSON.stringify({ schema: 1, items: "no" }), JSON.stringify({ schema: 1, items: [] }),
        JSON.stringify({ schema: 1, items: [{ forme: ["una"] }] }),
        JSON.stringify({ schema: 1, items: [{ forme: ["una", " "] }] }),
        JSON.stringify({ schema: 1, items: [{ forme: ["una", 1] }] })]) {
        plan = { status: 200, body: invalid };
        const { context, page } = await open(origin + "/sviluppo/");
        await page.locator("#apri-coola").click();
        await page.waitForFunction(() => document.querySelector("#stato-coola").textContent === "La raccolta CoolA non è disponibile in questo momento.");
        assert.equal(await page.locator(".coola-gruppo").count(), 0);
        assert.deepEqual(await page.evaluate(() => window.__rejections), []);
        await page.keyboard.press("Escape"); await returned(page); await context.close();
    }
    plan = { status: 503, body: "Non disponibile" };
    const retry = await open(origin + "/sviluppo/");
    await retry.page.locator("#apri-coola").click();
    await retry.page.waitForFunction(() => document.querySelector("#stato-coola").textContent.includes("non è disponibile"));
    await retry.page.keyboard.press("Escape"); await returned(retry.page);
    plan = { status: 200, body: bytes };
    await retry.page.locator("#apri-coola").click(); await loaded(retry.page); await content(retry.page);
    await retry.context.close(); expectedFailure = false;
    report.checks.push("JSON malformato/schema/items/forme invalidi ed errore HTTP gestiti senza crash; nuova apertura ritenta dopo errore");
    const literal = '<img src="x" onerror="window.__injection=true">';
    plan = { status: 200, body: JSON.stringify({ schema: 1, items: [{ forme: [literal, "testo"] }] }) };
    const injection = await open(origin + "/sviluppo/");
    await injection.page.locator("#apri-coola").click(); await loaded(injection.page);
    await content(injection.page, [[literal, "testo"]]);
    assert.equal(await injection.page.locator("#raccolta-coola img").count(), 0);
    assert.equal(await injection.page.evaluate(() => window.__injection), undefined);
    await injection.context.close();
    report.checks.push("DOM/textContent: payload HTML reso come testo, nessuna injection o richiesta di asset esterno");
    assert.deepEqual(report.errors, []);
    report.result = "PASS";
    await writeFile(path.join(out, "coola-report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} finally {
    await browser.close(); await new Promise(resolve => server.close(resolve));
}
