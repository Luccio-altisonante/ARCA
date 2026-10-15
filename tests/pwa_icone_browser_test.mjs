// node tests/pwa_icone_browser_test.mjs <root> <playwright-module> [external-output-directory]
import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verificaIcone, nomiIcone, dimensioniIcone, iconeManifest } from "./pwa_icone_test.mjs";

const root = path.resolve(process.argv[2]);
const out = process.argv[4] ? path.resolve(process.argv[4]) : await mkdtemp(path.join(os.tmpdir(), "arca-icons-"));
const relativeOutput = path.relative(root, out);
assert(relativeOutput && (relativeOutput === ".." || relativeOutput.startsWith(".." + path.sep) || path.isAbsolute(relativeOutput)),
    "Output browser fuori dal repository");
await mkdir(out, { recursive: true });
const profile = await mkdtemp(path.join(out, "chrome-profile-"));
const { chromium } = await import(pathToFileURL(process.argv[3]));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const report = { icons: await verificaIcone(root), errors: [], requests: [], checks: [] };
const dist = path.join(root, "dist");
const inventory = JSON.parse(await readFile(path.join(dist, "release.json")));
report.release = inventory.release_id;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
    ".wasm": "application/wasm", ".json": "application/json", ".webmanifest": "application/manifest+json",
    ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };
const server = createServer(async (request, response) => {
    try {
        const url = new URL(request.url, "http://localhost");
        assert(url.pathname.startsWith("/arca/"));
        const file = path.resolve(dist, decodeURIComponent(url.pathname.slice("/arca/".length)) || "index.html");
        assert(file.startsWith(dist + path.sep));
        response.setHeader("Content-Type", types[path.extname(file)] ?? "application/octet-stream");
        response.setHeader("Cache-Control", "no-store");
        response.end(await readFile(file));
    } catch (error) { report.errors.push("HTTP: " + error.message); response.writeHead(404).end(); }
});
let context, offline = false;
try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}/arca/`;
    report.url = url;
    // Profilo temporaneo normale, non il profilo personale e non una finestra incognito.
    context = await chromium.launchPersistentContext(profile, {
        executablePath: process.env.PWA_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
        headless: true, viewport: { width: 1440, height: 1000 },
    });
    report.browser = context.browser().version();
    await context.addInitScript(() => {
        window.__installEvents = { beforeinstallprompt: 0, appinstalled: 0 };
        window.addEventListener("beforeinstallprompt", () => { window.__installEvents.beforeinstallprompt++; });
        window.addEventListener("appinstalled", () => { window.__installEvents.appinstalled++; });
    });
    const page = await context.newPage();
    page.on("pageerror", error => report.errors.push(error.message));
    page.on("console", message => {
        if (message.type() === "error" && !(offline && /net::ERR_INTERNET_DISCONNECTED/.test(message.text()))) {
            report.errors.push(message.text());
        }
    });
    page.on("response", response => {
        report.requests.push({ url: response.url(), status: response.status(), serviceWorker: response.fromServiceWorker() });
        if (response.status() >= 400) report.errors.push(response.status() + ": " + response.url());
    });
    await page.goto(url);
    const ready = flag => page.waitForFunction(offline => document.querySelector("#stato-sillabe").textContent ===
        "Filtro sillabico disponibile" + (offline ? " offline" : ""), flag, { timeout: 120000 });
    await ready(false);
    const cdp = await context.newCDPSession(page);
    report.chromeManifest = await cdp.send("Page.getAppManifest");
    assert.deepEqual(report.chromeManifest.errors, []);
    const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute("href");
    const absoluteManifest = new URL(manifestUrl, url).href;
    assert.equal(report.chromeManifest.url, absoluteManifest);
    const manifest = JSON.parse(report.chromeManifest.data);
    const manifestResponse = await page.request.get(absoluteManifest);
    assert.equal(manifestResponse.status(), 200);
    assert.equal(manifestResponse.headers()["content-type"], "application/manifest+json");
    assert.deepEqual(await manifestResponse.json(), manifest);
    assert.deepEqual(manifest.icons, iconeManifest);
    assert.equal(new URL(manifest.scope, absoluteManifest).href, url);
    assert.equal(new URL(manifest.start_url, absoluteManifest).href, url);
    assert.equal(manifest.display, "standalone");
    assert.equal(report.chromeManifest.manifest.display, "kStandalone");
    assert.equal(report.chromeManifest.manifest.startUrl, url);
    assert.equal(report.chromeManifest.manifest.scope, url);
    assert.deepEqual(report.chromeManifest.manifest.icons, manifest.icons.map(icon => ({
        url: new URL(icon.src, absoluteManifest).href, sizes: icon.sizes, type: icon.type,
    })));
    const links = await page.locator('head link[rel="icon"], head link[rel="apple-touch-icon"]').evaluateAll(elements =>
        elements.map(element => ({ rel: element.rel, href: element.href, type: element.type, sizes: element.sizes.value })));
    assert.deepEqual(links.map(link => [link.rel, link.type, link.sizes]), [
        ["icon", "image/x-icon", "16x16 32x32 48x48"], ["icon", "image/png", "32x32"],
        ["icon", "image/png", "16x16"], ["apple-touch-icon", "", "180x180"],
    ]);
    const releaseBase = new URL(`releases/${inventory.release_id}/`, url).href;
    for (const link of links) assert(link.href.startsWith(releaseBase + "assets/icons/"));
    for (const name of nomiIcone) {
        for (const base of [url, releaseBase]) {
            const response = await page.request.get(base + "assets/icons/" + name);
            assert.equal(response.status(), 200);
            assert.equal(response.headers()["content-type"], name.endsWith(".png") ? "image/png" : "image/x-icon");
            assert.equal(sha(await response.body()), report.icons[name].sha256);
        }
        const size = await page.evaluate(async src => {
            const image = new Image(); image.src = src; await image.decode();
            return [image.naturalWidth, image.naturalHeight];
        }, releaseBase + "assets/icons/" + name);
        if (dimensioniIcone[name]) assert.deepEqual(size, [dimensioniIcone[name], dimensioniIcone[name]]);
        else assert([16, 32, 48].includes(size[0]) && size[0] === size[1]);
    }
    report.checks.push("Manifest riconosciuto da Chrome; 4 icone any/maskable; 9 asset HTTP 200/MIME/hash/decode; favicon/apple locali versionati");
    await page.evaluate(async () => {
        const worker = (await navigator.serviceWorker.ready).active;
        if (worker.state !== "activated") {
            await new Promise(resolve => worker.addEventListener("statechange", () => {
                if (worker.state === "activated") resolve();
            }));
        }
    });
    report.serviceWorker = await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.ready;
        return { scope: registration.scope, state: registration.active.state, script: registration.active.scriptURL };
    });
    assert.equal(report.serviceWorker.scope, url); assert.equal(report.serviceWorker.state, "activated");
    report.chromeInstallability = await cdp.send("Page.getInstallabilityErrors");
    assert.deepEqual(report.chromeInstallability.installabilityErrors, []);
    const primary = await cdp.send("Page.getManifestIcons");
    report.primaryIconBytes = primary.primaryIcon ? Buffer.from(primary.primaryIcon, "base64").length : 0;
    assert(report.primaryIconBytes > 0, "Chrome deve selezionare un'icona primaria");
    await page.locator("#comando").click();
    await page.waitForFunction(() => window.__installEvents.beforeinstallprompt > 0, null, { timeout: 12000 }).catch(() => null);
    report.installEvents = await page.evaluate(() => window.__installEvents);
    report.installBannerVisible = await page.locator("#onboarding-installazione").isVisible();
    assert.equal(report.installBannerVisible, report.installEvents.beforeinstallprompt > 0);
    report.installationPerformed = false;
    await page.locator("#comando").blur();
    await page.screenshot({ path: path.join(out, "arca-icons-desktop.png"), fullPage: true });
    await page.reload(); await ready(false);
    assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
    const cacheName = "anagrammi-app-release-" + inventory.release_id;
    report.shellCachedIcons = await page.evaluate(async ({ cacheName, releaseBase }) => {
        const cache = await caches.open(cacheName);
        return (await cache.keys()).map(request => request.url).filter(url => url.startsWith(releaseBase + "assets/icons/"));
    }, { cacheName, releaseBase });
    assert.equal(report.shellCachedIcons.length, 9);
    assert(!inventory.assets.some(asset => asset.path.startsWith("data/runtime-sillabe") || asset.path.endsWith(".bin")));
    await page.setViewportSize({ width: 390, height: 844 });
    offline = true; await context.setOffline(true); await page.reload(); await ready(true);
    const offlineIcons = await page.evaluate(async urls => {
        const result = [];
        for (const url of urls) {
            const response = await fetch(url);
            result.push({ status: response.status, bytes: (await response.arrayBuffer()).byteLength });
        }
        const manifest = await fetch(document.querySelector('link[rel="manifest"]').href);
        return { icons: result, manifestStatus: manifest.status };
    }, report.shellCachedIcons);
    assert(offlineIcons.icons.every(icon => icon.status === 200 && icon.bytes > 0));
    assert.equal(offlineIcons.manifestStatus, 200);
    await page.locator("#filtra-sillabe").check(); await page.locator("#minimo-sillabe").fill("2");
    await page.locator("#comando").fill("*"); await page.locator("#esegui").click();
    await page.waitForFunction(() => document.querySelector('.footer-risultati')?.textContent.includes("16711"));
    assert.equal(await page.locator(".testo-risultato").count(), 100);
    await page.locator("#pagina-successiva").click(); assert.match(await page.locator("#stato-pagina").innerText(), /101/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(out, "arca-icons-mobile-offline.png"), fullPage: true });
    report.checks.push("SW attivo; 9 icone e manifest offline dalla shell; runtime separato disponibile offline; * esattamente 2 = 16711, paginazione 100");
    assert.deepEqual(report.errors, []);
    report.result = "PASS";
    await writeFile(path.join(out, "pwa-icone-report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ result: report.result, browser: report.browser, url, checks: report.checks,
        chromeInstallability: report.chromeInstallability, installEvents: report.installEvents,
        installationPerformed: report.installationPerformed, output: out }, null, 2));
} finally {
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
}
