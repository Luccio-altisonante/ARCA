const NOME_CACHE = "anagrammi-app-syllable-runtime-v1";

export function creaStorageRuntimeSillabe(base, {
    cacheStorage = globalThis.caches,
    locks = globalThis.navigator?.locks,
} = {}) {
    const directory = new URL("./", base);
    const puntatore = new URL(".anagrammi-approved-runtime-v1", directory).href;
    const lock = `${NOME_CACHE}:${directory.href}`;
    const artifactUrl = manifest => new URL(manifest.artifact, directory).href;
    const riconosci = manifest => manifest && typeof manifest.artifact_sha256 === "string" &&
        manifest.artifact_sha256.length === 64 && /^[0-9a-f]{64}$/.test(manifest.artifact_sha256) &&
        manifest.artifact === `runtime-sillabe-${manifest.artifact_sha256}.bin`;
    const rispostaJson = data => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    const obsoleto = new Error("Generazione runtime non piu' attiva.");
    const controlla = attiva => { if (!attiva()) throw obsoleto; };

    function serializza(scrittura, action) {
        if (!cacheStorage) return Promise.resolve(null);
        if (locks?.request) return locks.request(lock, { mode: "exclusive" }, action);
        // Senza lock cross-tab possiamo leggere, ma non promuovere o eseguire GC.
        return scrittura ? Promise.resolve(false) : action();
    }

    async function leggiPuntatore(cache, attiva = () => true) {
        const entry = await cache.match(puntatore);
        controlla(attiva);
        if (!entry) return { schema: 1, corrente: null, precedente: null };
        const data = await entry.json();
        controlla(attiva);
        if (!data || Array.isArray(data) || data.schema !== 1 ||
            data.corrente !== null && !riconosci(data.corrente) ||
            data.precedente !== null && !riconosci(data.precedente)) {
            throw new Error("Metadata runtime locale non valida.");
        }
        return data;
    }

    async function pulisci(cache, data, attiva = () => true) {
        const keep = new Set([data.corrente, data.precedente].filter(Boolean).map(artifactUrl));
        const requests = await cache.keys();
        controlla(attiva);
        for (const request of requests) {
            controlla(attiva);
            const url = new URL(request.url);
            if (url.href.startsWith(directory.href) &&
                /^runtime-sillabe-[0-9a-f]{64}\.bin$/.test(url.href.slice(directory.href.length)) &&
                !keep.has(url.href)) {
                await cache.delete(request);
                controlla(attiva);
            }
        }
    }

    async function leggiApprovato(attiva) {
        return serializza(false, async () => {
            controlla(attiva);
            if (!await cacheStorage.has(NOME_CACHE)) return null;
            controlla(attiva);
            const cache = await cacheStorage.open(NOME_CACHE);
            controlla(attiva);
            const data = await leggiPuntatore(cache, attiva);
            controlla(attiva);
            if (locks?.request) {
                try { await pulisci(cache, data); }
                catch (error) { console.warn("GC runtime rimandata:", error); }
                controlla(attiva);
            }
            if (!data.corrente) return null;
            const response = await cache.match(artifactUrl(data.corrente));
            controlla(attiva);
            if (!response) throw new Error("Artifact approvato locale mancante.");
            const bytes = new Uint8Array(await response.arrayBuffer());
            controlla(attiva);
            return { manifest: data.corrente, bytes };
        });
    }

    // Il chiamante deve aver gia' associato questi byte con successo nel core C++.
    async function approva(manifest, bytes, attiva) {
        const copia = { ...manifest };
        const contenuto = bytes.slice();
        return serializza(true, async () => {
            controlla(attiva);
            const cache = await cacheStorage.open(NOME_CACHE);
            controlla(attiva);
            const old = await leggiPuntatore(cache, attiva);
            controlla(attiva);
            const backup = new Map();
            for (const manifest of [old.corrente, old.precedente].filter(Boolean)) {
                const url = artifactUrl(manifest);
                const response = await cache.match(url);
                controlla(attiva);
                if (response) backup.set(url, response);
            }
            let pubblicato = false;
            try {
                await cache.put(artifactUrl(copia), new Response(contenuto, {
                    headers: { "Content-Type": "application/octet-stream" },
                }));
                controlla(attiva);
                let precedente = old.corrente?.artifact === copia.artifact ? old.precedente : old.corrente;
                if (precedente && !await cache.match(artifactUrl(precedente))) precedente = null;
                controlla(attiva);
                const next = { schema: 1, corrente: copia, precedente };
                // Commit logico: i byte sono gia' completi; il puntatore e' l'ultimo put.
                await cache.put(puntatore, rispostaJson(next));
                pubblicato = true;
                controlla(attiva);
                try { await pulisci(cache, next, attiva); }
                catch (error) {
                    if (error === obsoleto) throw error;
                    console.warn("GC runtime rimandata:", error);
                }
                controlla(attiva);
                return true;
            } catch (error) {
                // Sotto lo stesso lock: nessuna scheda puo' leggere un commit obsoleto.
                if (pubblicato && error === obsoleto) {
                    // La GC puo' aver cancellato il precedente di old: prima i byte, poi il puntatore.
                    for (const [url, response] of backup) {
                        if (!await cache.match(url)) await cache.put(url, response);
                    }
                    await cache.put(puntatore, rispostaJson(old));
                }
                await pulisci(cache, pubblicato && error !== obsoleto ? await leggiPuntatore(cache) : old);
                throw error;
            }
        });
    }

    async function scartaApprovato(manifest, attiva) {
        return serializza(true, async () => {
            controlla(attiva);
            const cache = await cacheStorage.open(NOME_CACHE);
            controlla(attiva);
            const old = await leggiPuntatore(cache, attiva);
            controlla(attiva);
            if (old.corrente?.artifact !== manifest.artifact) return;
            const oldUrl = artifactUrl(old.corrente);
            const backup = await cache.match(oldUrl);
            controlla(attiva);
            const next = { schema: 1, corrente: old.precedente, precedente: null };
            let pubblicato = false;
            try {
                await cache.put(puntatore, rispostaJson(next));
                pubblicato = true;
                controlla(attiva);
                await pulisci(cache, next, attiva);
                controlla(attiva);
            } catch (error) {
                if (pubblicato) {
                    // Una delete gia' in volo puo' finire dopo il cambio generazione.
                    // Ripristina prima i byte necessari, poi il puntatore, sotto il lock.
                    if (backup && !await cache.match(oldUrl)) await cache.put(oldUrl, backup);
                    await cache.put(puntatore, rispostaJson(old));
                }
                throw error;
            }
        });
    }

    return { leggiApprovato, approva, scartaApprovato };
}
