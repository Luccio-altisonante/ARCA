const RELEASE = __ANAGRAMMI_RELEASE_INVENTORY__;
const PREFIX = "anagrammi-app-release-";
const CACHE = PREFIX + RELEASE.release_id;
const META = "anagrammi-app-metadata-v1";
const base = new URL(self.registration.scope);
const metadataUrl = new URL(".anagrammi-app-metadata", base).href;
const releaseBase = id => new URL(`releases/${id}/`, base);
const inventoryUrl = id => new URL("release.json", releaseBase(id)).href;
const validId = id => typeof id === "string" && /^[0-9a-f]{64}$/.test(id) && id.length === 64;

async function digest(bytes) {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        value => value.toString(16).padStart(2, "0")).join("");
}

async function verifiedResponse(url, asset) {
    const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error(`Asset release non disponibile: ${url}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== asset.size_bytes || await digest(bytes) !== asset.sha256) {
        throw new Error(`Asset release incoerente: ${url}`);
    }
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
}

async function completeInventory(id) {
    if (!validId(id)) return null;
    const names = await caches.keys();
    if (!names.includes(PREFIX + id)) return null;
    const cache = await caches.open(PREFIX + id);
    const marker = await cache.match(inventoryUrl(id));
    if (!marker) return null;
    try {
        const inventory = await marker.json();
        if (inventory.schema !== 1 || inventory.release_id !== id || !Array.isArray(inventory.assets)) return null;
        for (const asset of inventory.assets) {
            if (!await cache.match(new URL(asset.path, releaseBase(id)))) return null;
        }
        return inventory;
    } catch { return null; }
}

self.addEventListener("install", event => event.waitUntil((async () => {
    if (await completeInventory(RELEASE.release_id)) return;
    const cache = await caches.open(CACHE);
    try {
        for (const asset of RELEASE.assets) {
            const url = new URL(asset.path, releaseBase(RELEASE.release_id));
            await cache.put(url, await verifiedResponse(url, asset));
        }
        // Il marker e' scritto solo dopo tutti gli asset: una cache parziale non e' completa.
        await cache.put(inventoryUrl(RELEASE.release_id), new Response(JSON.stringify(RELEASE), {
            headers: { "Content-Type": "application/json" },
        }));
    } catch (error) {
        await caches.delete(CACHE);
        throw error;
    }
})()));

self.addEventListener("activate", event => event.waitUntil((async () => {
    const meta = await caches.open(META);
    let old = null;
    try { old = await (await meta.match(metadataUrl))?.json(); } catch { /* Nessun precedente affidabile. */ }
    const candidate = old?.current === RELEASE.release_id ? old.previous : old?.current;
    const previous = await completeInventory(candidate) ? candidate : null;
    const keep = new Set([CACHE, ...(previous ? [PREFIX + previous] : [])]);
    try {
        await meta.put(metadataUrl, new Response(JSON.stringify({ current: RELEASE.release_id, previous }), {
            headers: { "Content-Type": "application/json" },
        }));
    } catch (error) { console.warn("Metadata cache Anagrammi non salvata:", error); }
    for (const name of await caches.keys()) {
        if (name.startsWith(PREFIX) && !keep.has(name)) await caches.delete(name);
    }
    // Nessun skipWaiting/clients.claim: non cambiare il controller delle sessioni aperte.
})()));

self.addEventListener("fetch", event => {
    if (event.request.method !== "GET") return;
    const url = new URL(event.request.url);
    if (url.origin !== base.origin) return;
    const navigation = event.request.mode === "navigate" &&
        (url.pathname === base.pathname || url.pathname === new URL("index.html", base).pathname);
    const immutablePrefix = new URL("releases/", base).pathname;
    if (!navigation && !url.pathname.startsWith(immutablePrefix)) return;
    event.respondWith((async () => {
        let id = RELEASE.release_id;
        let path = "index.html";
        if (!navigation) {
            const relative = url.pathname.slice(immutablePrefix.length);
            const separator = relative.indexOf("/");
            id = relative.slice(0, separator);
            path = relative.slice(separator + 1);
            if (!validId(id)) return fetch(event.request);
        }
        const inventory = id === RELEASE.release_id ? RELEASE : await completeInventory(id);
        const asset = inventory?.assets.find(item => item.path === path);
        if (!asset) return fetch(event.request);
        const cache = await caches.open(PREFIX + id);
        const assetUrl = new URL(path, releaseBase(id));
        const cached = await cache.match(assetUrl);
        if (cached) return cached;
        const response = await verifiedResponse(assetUrl, asset);
        try { await cache.put(assetUrl, response.clone()); } catch { /* La rete resta utilizzabile se manca spazio. */ }
        return response;
    })());
});
