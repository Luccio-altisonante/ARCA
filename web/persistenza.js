const nomeDatabase = "anagrammi-e-non-solo";
const versioneDatabase = 1;
const archivio = "vocabolari";
const chiavePersonale = "personale";

function apriDatabase() {
    return new Promise((resolve, reject) => {
        const richiesta = indexedDB.open(nomeDatabase, versioneDatabase);

        richiesta.onupgradeneeded = () => {
            const database = richiesta.result;
            if (!database.objectStoreNames.contains(archivio)) {
                database.createObjectStore(archivio, { keyPath: "id" });
            }
        };
        richiesta.onsuccess = () => resolve(richiesta.result);
        richiesta.onerror = () => reject(richiesta.error ?? new Error("Impossibile aprire IndexedDB."));
        richiesta.onblocked = () => reject(new Error("IndexedDB e' bloccato da un'altra scheda aperta."));
    });
}

async function usaArchivio(modalita, operazione) {
    const database = await apriDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const transazione = database.transaction(archivio, modalita);
            const store = transazione.objectStore(archivio);
            let risultato;

            transazione.oncomplete = () => resolve(risultato);
            transazione.onerror = () => reject(transazione.error ?? new Error("Operazione IndexedDB non riuscita."));
            transazione.onabort = () => reject(transazione.error ?? new Error("Operazione IndexedDB annullata."));

            const richiesta = operazione(store);
            if (richiesta) {
                richiesta.onsuccess = () => {
                    risultato = richiesta.result;
                };
                richiesta.onerror = () => reject(richiesta.error ?? new Error("Operazione IndexedDB non riuscita."));
            }
        });
    } finally {
        database.close();
    }
}

export function leggiVocabolarioPersonale() {
    return usaArchivio("readonly", (store) => store.get(chiavePersonale));
}

export function salvaVocabolarioPersonale(dati) {
    return usaArchivio("readwrite", (store) => store.put({ ...dati, id: chiavePersonale }));
}

export function eliminaVocabolarioPersonale() {
    return usaArchivio("readwrite", (store) => store.delete(chiavePersonale));
}
