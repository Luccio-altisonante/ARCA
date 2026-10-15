// node tests/web_presentazione_test.mjs <root> <playwright-module>
// Isola la presentazione; i test runtime/paginazione verificano il motore reale.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { verificaBlocchiStoria, paperPdf } from "./storia_test.mjs";

const root = path.resolve(process.argv[2]);
const { chromium } = await import(pathToFileURL(process.argv[3]));
const errors = [];
const html = (await readFile(path.join(root, "web/index.html"), "utf8"))
    .replace('<script type="module" src="./app.js"></script>', "");
const server = createServer(async (request, response) => {
    try {
        const pathname = new URL(request.url, "http://localhost").pathname;
        if (pathname === "/") {
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end(html);
            return;
        }
        const file = path.resolve(root, "web", "." + pathname);
        assert(file.startsWith(path.join(root, "web") + path.sep));
        response.setHeader("Content-Type", {
            ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".ico": "image/x-icon",
            ".webmanifest": "application/manifest+json",
            ".pdf": "application/pdf",
        }[path.extname(file)] ?? "application/octet-stream");
        response.end(await readFile(file));
    } catch (error) {
        errors.push(String(error));
        response.writeHead(404).end();
    }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = "http://127.0.0.1:" + server.address().port + "/";
const browser = await chromium.launch({
    executablePath: process.env.PWA_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
});
let groups = 0;
const pass = name => { groups++; console.log("PASS ARCA: " + name); };
async function open(options = {}, standalone = false) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
    if (standalone) await context.addInitScript(() => {
        Object.defineProperty(navigator, "standalone", { value: true });
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(url);
    // Verifica che il modulo abbia collegato i listener prima degli eventi sintetici.
    await page.locator('[data-guida="anagrammi"]').click();
    await page.locator('[data-guida="anagrammi"]').click();
    return { page, context };
}
async function installEvent(page, outcome = "dismissed") {
    await page.evaluate(outcome => {
        window.__promptCalls = 0;
        const event = new Event("beforeinstallprompt", { cancelable: true });
        event.prompt = async () => { window.__promptCalls++; };
        event.userChoice = Promise.resolve({ outcome });
        window.dispatchEvent(event);
        window.__prevented = event.defaultPrevented;
    }, outcome);
}
async function layout(page) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).isolation), "isolate");
    assert.equal(await page.locator(".card-modalita strong").evaluateAll(elements => elements.every(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length === 1;
    })), true, "I nomi delle modalita' non devono spezzarsi");
    assert.equal(await page.evaluate(() => {
        const search = document.querySelector(".ricerca-principale");
        const results = search.nextElementSibling;
        const vocabulary = results.nextElementSibling;
        return search.nextElementSibling.matches(".risultati") &&
            search.contains(document.querySelector("#stato-vocabolario")) &&
            search.contains(document.querySelector(".filtro-sillabe")) &&
            !search.contains(document.querySelector("#vocabolario-attivo")) &&
            vocabulary.matches(".vocabolario") &&
            vocabulary.contains(document.querySelector("#vocabolario-attivo")) &&
            vocabulary.contains(document.querySelector(".gestione-vocabolario")) &&
            vocabulary.nextElementSibling.matches(".guide-comandi") &&
            document.querySelector("#risultato").closest(".risultati") === results &&
            document.querySelector("#comando").getBoundingClientRect().bottom <=
                document.querySelector(".filtro-sillabe").getBoundingClientRect().top &&
            results.getBoundingClientRect().top >= search.getBoundingClientRect().bottom &&
            vocabulary.getBoundingClientRect().top >= results.getBoundingClientRect().bottom;
    }), true);
    const ids = await page.locator("[id]").evaluateAll(elements => elements.map(e => e.id));
    assert.equal(new Set(ids).size, ids.length);
}
try {
    const { page, context } = await open();
    assert.equal(await page.title(), "ARCA · Assonanze, Rime, Consonanze e Anagrammi");
    assert.deepEqual(await page.locator(".card-modalita strong").allTextContents(),
        ["Assonanze", "Rime", "Consonanze", "Anagrammi"]);
    assert.deepEqual(await page.locator("#navigazione a").allTextContents(),
        ["Home", "Storia del progetto", "Crediti e licenze"]);
    assert.equal(await page.locator("#modalita-sillabe option").count(), 4);
    await layout(page);
    let boxes = await page.locator(".card-modalita").evaluateAll(elements =>
        elements.map(e => ({ top: e.getBoundingClientRect().top, width: e.getBoundingClientRect().width })));
    assert(boxes.every(box => box.top === boxes[0].top));
    await page.locator('[data-dialog="crediti"]').click();
    assert.equal(await page.locator("#crediti").evaluate(e => e.open), true);
    assert.match(await page.locator("#crediti").innerText(), /CC BY-SA 4.0/);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector("#crediti").open &&
        document.activeElement === document.querySelector('[data-dialog="crediti"]'));
    assert.equal(await page.locator('[data-dialog="crediti"]').evaluate(e => e === document.activeElement), true);
    pass("gerarchia, ID, controlli esistenti, quattro card, crediti e focus dialog");

    for (const [width, height] of [[1440, 1000], [390, 844], [320, 740]]) {
        await page.setViewportSize({ width, height });
        if (width !== 1440 && await page.locator("#menu-navigazione").getAttribute("aria-expanded") !== "true") await page.locator("#menu-navigazione").click();
        const opener = page.locator('[data-dialog="storia"]');
        await opener.focus();
        await opener.click();
        const story = page.locator("#storia");
        assert(await story.evaluate(dialog => dialog.open));
        assert.equal(await page.locator("#menu-navigazione").getAttribute("aria-expanded"), "false");
        verificaBlocchiStoria(await story.locator("h2, p, h3, li").allTextContents());
        assert.deepEqual(await story.locator("a").evaluateAll(links => links.map(link => link.getAttribute("href"))), paperPdf.map(file => "./" + file));
        assert(await story.evaluate(dialog => {
            const box = dialog.getBoundingClientRect();
            return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight &&
                dialog.scrollWidth <= dialog.clientWidth && dialog.scrollHeight > dialog.clientHeight;
        }));
        await story.locator("button").scrollIntoViewIfNeeded();
        await page.keyboard.press("Escape");
        assert.equal(await story.isVisible(), false);
        await page.waitForFunction(() => document.activeElement === document.querySelector('[data-dialog="storia"]'));
        assert.equal(await page.locator("#navigazione").isVisible(), true);
        assert.equal(await page.locator("#menu-navigazione").getAttribute("aria-expanded"), String(width !== 1440));
        pass(`Storia: Escape e focus sul trigger, menu corretto a ${width}x${height}`);

        // Aperture ripetute verificano anche il listener close one-shot.
        for (let repeat = 0; repeat < 2; repeat++) {
            const creditsOpener = page.locator('[data-dialog="crediti"]');
            await creditsOpener.focus();
            await creditsOpener.click();
            assert.equal(await page.locator("#crediti").evaluate(dialog => dialog.open), true);
            assert.equal(await page.locator("#menu-navigazione").getAttribute("aria-expanded"), "false");
            await page.keyboard.press("Escape");
            await page.waitForFunction(() => !document.querySelector("#crediti").open &&
                document.activeElement === document.querySelector('[data-dialog="crediti"]'));
            assert.equal(await page.locator("#crediti").isVisible(), false);
            assert.equal(await page.locator("#navigazione").isVisible(), true);
            assert.equal(await page.locator("#menu-navigazione").getAttribute("aria-expanded"), String(width !== 1440));
        }
        pass(`Crediti: Escape e focus sul trigger, menu corretto e riapertura a ${width}x${height}`);
    }
    if (await page.locator("#menu-navigazione").getAttribute("aria-expanded") === "true") await page.locator("#menu-navigazione").click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    pass("Storia approvata, PDF, scroll, viewport 1440/390/320, Escape e focus");

    await page.evaluate(() => {
        for (const id of ["comando", "crea-personale"]) document.getElementById(id).disabled = false;
        document.getElementById("crea-personale").addEventListener("click", () => { window.__created = true; });
        document.getElementById("usa-personale").addEventListener("click", () => { window.__used = true; });
    });
    await page.locator("#onboarding-personale-azione").click();
    assert.equal(await page.evaluate(() => window.__created), true);
    await page.evaluate(() => {
        document.getElementById("usa-personale").disabled = false;
        document.getElementById("elimina-personale").disabled = false;
    });
    await page.locator("#onboarding-personale-azione").click();
    assert.equal(await page.evaluate(() => window.__used), true);
    assert.equal(await page.locator("#onboarding-personale-azione").innerText(), "Usa copia personale");
    await page.evaluate(() => { document.getElementById("vocabolario-attivo").dataset.modalita = "personale"; });
    await page.waitForFunction(() => document.getElementById("onboarding-personale").hidden);
    await page.evaluate(() => { document.getElementById("vocabolario-attivo").dataset.modalita = "originale"; });
    await page.waitForFunction(() => !document.getElementById("onboarding-personale").hidden);
    pass("onboarding personale inoltra le azioni esistenti e scompare solo sul personale attivo");

    const esempiGuide = {
        assonanze: ["*a??a", "*e??e", "*o??o"],
        rime: ["*are", "*ore", "*ello"],
        consonanze: ["c?s?", "p?rt?", "m?r?"],
        anagrammi: ["mare", "roma", "cartone 5"],
    };
    for (const [mode, examples] of Object.entries(esempiGuide)) {
        const trigger = page.locator('[data-guida="' + mode + '"]');
        await trigger.focus();
        await page.keyboard.press("Enter");
        assert.equal(await page.locator("#guida-modalita").isVisible(), true);
        assert.equal(await trigger.getAttribute("aria-expanded"), "true");
        assert.equal(await trigger.getAttribute("aria-controls"), "guida-modalita");
        assert.equal(await page.locator('[data-guida][aria-expanded="true"]').count(), 1);
        assert.deepEqual(await page.locator("#esempi-guida button").allTextContents(), examples);
        if (mode === "assonanze" || mode === "consonanze") {
            assert.match(await page.locator("#testo-guida").innerText(), /non (da )?un'analisi fonetica/);
        }
        const example = page.locator("#esempi-guida button").first();
        const text = await example.innerText();
        await example.click();
        assert.equal(await page.locator("#comando").inputValue(), text);
        await page.locator("#comando").fill("?a??e*r?");
        assert.equal(await page.locator("#comando").inputValue(), "?a??e*r?");
    }
    await page.locator('[data-guida="anagrammi"]').focus();
    await page.keyboard.press("Space");
    assert.equal(await page.locator("#guida-modalita").isVisible(), false);
    assert.equal(await page.locator('[data-guida][aria-expanded="true"]').count(), 0);
    pass("guide esclusive/richiudibili da tastiera, esempi verificati e barra sempre libera");

    assert.equal(await page.locator("#onboarding-installazione").isVisible(), false);
    await installEvent(page);
    assert.equal(await page.locator("#onboarding-installazione").isVisible(), true);
    assert.equal(await page.evaluate(() => window.__prevented), true);
    await page.locator("#installa-arca").click();
    assert.equal(await page.evaluate(() => window.__promptCalls), 1);
    await page.waitForFunction(() => document.getElementById("onboarding-installazione").hidden);
    await installEvent(page, "accepted");
    await page.locator("#installa-arca").click();
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    assert.equal(await page.locator("#onboarding-installazione").isVisible(), false);
    await installEvent(page);
    assert.equal(await page.locator("#onboarding-installazione").isVisible(), false);
    pass("beforeinstallprompt reale, esito dismissed/accepted, appinstalled e nessuna installazione simulata");

    await page.setViewportSize({ width: 390, height: 844 });
    await layout(page);
    boxes = await page.locator(".card-modalita").evaluateAll(elements =>
        elements.map(e => ({ top: e.getBoundingClientRect().top })));
    assert.equal(boxes[0].top, boxes[1].top);
    assert.equal(boxes[2].top, boxes[3].top);
    assert(boxes[2].top > boxes[0].top);
    await page.locator("#menu-navigazione").click();
    assert.equal(await page.locator("#navigazione").isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#navigazione").isVisible(), false);
    await page.locator(".altre-funzioni summary").click();
    assert.match(await page.locator(".altre-funzioni").innerText(), /\+ parola/);
    assert.match(await page.locator(".altre-funzioni").innerText(), /- parola/);
    assert.match(await page.locator(".legenda").innerText(), /zero o più lettere/);
    await page.setViewportSize({ width: 320, height: 740 });
    await layout(page);
    for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        const background = await page.evaluate(() => {
            const style = getComputedStyle(document.body, "::before");
            return { size: style.backgroundSize, position: style.backgroundPosition, height: parseFloat(style.height) };
        });
        assert.equal(background.size, "100% 100%, 100% auto");
        assert.equal(background.position, "50% 50%, 50% 58px");
        assert(Math.abs(background.height - (58 + width * .5628)) < .1);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    pass("mobile 390/320, 2x2, menu/tastiera, legenda esatta e nessun overflow");

    const colori = () => page.evaluate(() => [".ricerca-principale", ".risultati", ".legenda", ".banner-personale"]
        .map(selector => {
            const style = getComputedStyle(document.querySelector(selector));
            return [style.backgroundColor, style.color];
        }));
    await page.emulateMedia({ colorScheme: "light" });
    const light = await colori();
    await page.emulateMedia({ colorScheme: "dark" });
    assert.equal(await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches), true);
    assert.deepEqual(await colori(), light);
    assert.equal(await page.locator('meta[name="color-scheme"]').getAttribute("content"), "only light");
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "light only");
    assert(html.indexOf('name="color-scheme"') < html.indexOf('rel="stylesheet"'));
    await layout(page);
    pass("preferenza dark: palette e contrasto invariati, only light prima del CSS");
    await context.close();

    const installed = await open({}, true);
    await installEvent(installed.page);
    assert.equal(await installed.page.locator("#onboarding-installazione").isVisible(), false);
    await installed.context.close();
    pass("navigator.standalone: banner nascosto anche con un evento tardivo");

    const iphone = await open({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
    assert.equal(await iphone.page.locator("#onboarding-installazione").isVisible(), true);
    await iphone.page.locator("#installa-arca").click();
    assert.equal(await iphone.page.locator("#guida-installazione").evaluate(e => e.open), true);
    await iphone.page.keyboard.press("Escape");
    await iphone.page.locator("#chiudi-installazione").click();
    assert.equal(await iphone.page.locator("#onboarding-installazione").isVisible(), false);
    await iphone.context.close();
    pass("iOS: istruzioni contestuali Safari, nessuna API inventata, chiusura banner");
    assert.deepEqual(errors, []);
    console.log("PASS: " + groups + " gruppi presentazione ARCA, nessun errore/404");
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
