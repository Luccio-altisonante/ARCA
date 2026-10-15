import {
    eliminaVocabolarioPersonale,
    leggiVocabolarioPersonale,
    salvaVocabolarioPersonale,
} from "./persistenza.js";
import { creaStorageRuntimeSillabe } from "./runtime-sillabe-storage.js";

const percorsoVocabolarioPredefinito = new URL("./data/VocabolarioItaliano.txt", import.meta.url);
const nomeVocabolarioPredefinito = "VocabolarioItaliano.txt";
const percorsoManifestSillabe = new URL("./data/runtime-sillabe.manifest.json", document.baseURI ?? import.meta.url);
const storageRuntimeSillabe = creaStorageRuntimeSillabe(percorsoManifestSillabe);
const timeoutRuntimeSillabeMs = 30000;
const risultatiPerPagina = 100;

const app = document.querySelector("#app");
const moduloRicerca = document.querySelector("#modulo-ricerca");
const comando = document.querySelector("#comando");
const esegui = document.querySelector("#esegui");
const filtraSillabe = document.querySelector("#filtra-sillabe");
const campiSillabe = document.querySelector("#campi-sillabe");
const modalitaSillabe = document.querySelector("#modalita-sillabe");
const minimoSillabe = document.querySelector("#minimo-sillabe");
const massimoSillabe = document.querySelector("#massimo-sillabe");
const campoMassimoSillabe = document.querySelector("#campo-massimo-sillabe");
const etichettaMinimoSillabe = document.querySelector("#etichetta-minimo-sillabe");
const statoSillabe = document.querySelector("#stato-sillabe");
const notaSillabe = document.querySelector("#nota-sillabe");
const erroreSillabe = document.querySelector("#errore-sillabe");
const risultato = document.querySelector("#risultato");
const paginazione = document.querySelector("#paginazione");
const paginaPrecedente = document.querySelector("#pagina-precedente");
const paginaSuccessiva = document.querySelector("#pagina-successiva");
const statoPagina = document.querySelector("#stato-pagina");
const esempiComando = document.querySelectorAll(".esempio-comando");
const fileVocabolario = document.querySelector("#file-vocabolario");
const usaOriginale = document.querySelector("#usa-originale");
const creaPersonale = document.querySelector("#crea-personale");
const usaPersonale = document.querySelector("#usa-personale");
const esportaPersonale = document.querySelector("#esporta-personale");
const eliminaPersonale = document.querySelector("#elimina-personale");
const riquadroVocabolario = document.querySelector("#vocabolario-attivo");
const tipoVocabolario = document.querySelector("#tipo-vocabolario");
const dettaglioVocabolario = document.querySelector("#dettaglio-vocabolario");
const conteggio = document.querySelector("#conteggio");
const statoVocabolario = document.querySelector("#stato-vocabolario");
const dialogoRimozione = document.querySelector("#conferma-rimozione");
const testoConfermaRimozione = document.querySelector("#testo-conferma-rimozione");
const annullaRimozione = document.querySelector("#annulla-rimozione");
const confermaEliminazione = document.querySelector("#conferma-eliminazione");
const tempoLettura = document.querySelector("#tempo-lettura");
const tempoCore = document.querySelector("#tempo-core");
const tempoTotale = document.querySelector("#tempo-totale");
const dimensioneFile = document.querySelector("#dimensione-file");
const memoriaWasm = document.querySelector("#memoria-wasm");

let motore = null;
let motoreSillabeUfficiale = null;
let bytesVocabolarioUfficiale = null;
let modulo = null;
let vocabolarioAttivo = null;
let vocabolarioPersonale = null;
let ultimoRisultato = null;
let paginaCorrente = 0;
let parolaDaRimuovere = "";
let risultatoDaRimuovere = null;
let caricamentoInCorso = true;
let urlEsportazione = "";
let generazioneMotore = 0;
let statoRuntimeSillabe = { generazione: 0, stato: "non_disponibile", manifest: null, errore: "" };

function validaManifestSillabe(manifest) {
    if (!manifest || Array.isArray(manifest) || manifest.schema !== 1 ||
        typeof manifest.disponibile !== "boolean") {
        throw new Error("Manifest sillabico: schema o disponibilita' non validi.");
    }
    if (!manifest.disponibile) {
        return manifest;
    }
    const sha256Valido = value => typeof value === "string" && value.length === 64 && /^[0-9a-f]{64}$/.test(value);
    const interoPositivo = value => Number.isSafeInteger(value) && value > 0;
    if (manifest.formato !== "sillabe-bitmap-le-v1" ||
        !sha256Valido(manifest.artifact_sha256) ||
        !sha256Valido(manifest.vocabolario_sha256) ||
        !interoPositivo(manifest.numero_grafie) || manifest.numero_grafie > 0xffffffff ||
        manifest.artifact !== `runtime-sillabe-${manifest.artifact_sha256}.bin` ||
        ("dimensione_byte" in manifest && !interoPositivo(manifest.dimensione_byte)) ||
        ("annotazioni_sha256" in manifest && !sha256Valido(manifest.annotazioni_sha256))) {
        throw new Error("Manifest sillabico: metadati o nome artifact non validi.");
    }
    return manifest;
}

function generazioneOriginaleAttiva(generazione) {
    return generazione === generazioneMotore && motore !== null && vocabolarioAttivo?.modalita === "originale";
}

async function caricaRuntimeSillabe(generazione) {
    let manifest = null;
    const personale = vocabolarioAttivo?.modalita === "personale";
    const attiva = () => generazione === generazioneMotore && motore !== null && vocabolarioAttivo !== null;
    if (personale && motoreSillabeUfficiale) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutRuntimeSillabeMs);
    let erroreTrasporto = false;
    async function rete(operazione) {
        try { return await operazione(); }
        catch (error) {
            if (!(error instanceof SyntaxError)) erroreTrasporto = true;
            throw error;
        }
    }
    async function rispostaRete(url, options) {
        const response = await rete(() => fetch(url, options));
        if (!attiva()) return null;
        if (!response.ok) {
            erroreTrasporto = true;
            throw new Error(`Runtime sillabico: errore HTTP ${response.status}.`);
        }
        return response;
    }
    function associa(bytes, dati, origine) {
        if ("dimensione_byte" in dati && bytes.byteLength !== dati.dimensione_byte) {
            throw new Error("Artifact sillabico: dimensione diversa dal manifest.");
        }
        // Solo coerenza preliminare: i byte non sono ancora affidabili.
        const minimoHeader = "annotazioni_sha256" in dati ? 128 : 96;
        if (bytes.byteLength < minimoHeader) {
            throw new Error("Artifact sillabico: header troppo corto per il precheck.");
        }
        const hex = part => Array.from(part, value => value.toString(16).padStart(2, "0")).join("");
        if (new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16, true) !== dati.numero_grafie ||
            hex(bytes.subarray(64, 96)) !== dati.vocabolario_sha256 ||
            ("annotazioni_sha256" in dati && hex(bytes.subarray(96, 128)) !== dati.annotazioni_sha256)) {
            throw new Error("Manifest sillabico diverso dai metadati dell'artifact.");
        }
        // Il precheck non verifica sicurezza/formato: C++ resta l'autorita' finale.
        // Nessun riferimento WASM attraversa un await: usa solo il motore attuale.
        let fonte = motore;
        if (personale) {
            fonte = new modulo.MotoreAnagrammi();
        }
        try {
            if (personale) fonte.carica_vocabolario_ordinato_con_identita_da_bytes(bytesVocabolarioUfficiale);
            fonte.associa_runtime_sillabe_da_bytes(bytes, dati.artifact_sha256);
            if (personale) {
                motore.prepara_sillabe_personali_da_ufficiale(fonte);
                if (ultimoRisultato) {
                    abbandonaRisultato();
                    mostraMessaggio("Dati sillabici aggiornati. Ripeti la ricerca.");
                }
            }
        } catch (error) {
            if (personale) fonte.delete();
            throw error;
        }
        const precedente = motoreSillabeUfficiale;
        motoreSillabeUfficiale = fonte;
        if (precedente && precedente !== motore && precedente !== fonte) precedente.delete();
        statoRuntimeSillabe = { generazione, stato: "pronto", manifest: dati, errore: "", origine };
        aggiornaFiltroSillabe();
    }
    try {
        if (personale && !bytesVocabolarioUfficiale) {
            const vocabolario = await rispostaRete(percorsoVocabolarioPredefinito, { cache: "no-store", signal: controller.signal });
            if (!attiva()) return;
            const dati = new Uint8Array(await rete(() => vocabolario.arrayBuffer()));
            if (!attiva()) return;
            bytesVocabolarioUfficiale = dati;
        }
        const risposta = await rispostaRete(percorsoManifestSillabe, { cache: "no-store", signal: controller.signal });
        if (!attiva()) return;
        const contenuto = await rete(() => risposta.json());
        if (!attiva()) return;
        manifest = validaManifestSillabe(contenuto);
        if (!manifest.disponibile) {
            if (personale) return;
            statoRuntimeSillabe = { generazione, stato: "non_disponibile", manifest, errore: "" };
            return;
        }
        const artifact = await rispostaRete(new URL(manifest.artifact, percorsoManifestSillabe),
            { cache: "no-store", signal: controller.signal });
        if (!attiva()) return;
        const bytes = new Uint8Array(await rete(() => artifact.arrayBuffer()));
        if (!attiva()) return;
        clearTimeout(timeout);
        associa(bytes, manifest, "rete");
        try {
            const salvato = await storageRuntimeSillabe.approva(manifest, bytes, attiva);
            if (!attiva()) return;
            if (!salvato) throw new Error("Cache Storage o Web Locks non disponibili.");
        } catch (error) {
            if (!attiva()) return;
            statoRuntimeSillabe.errorePersistenza = messaggioErrore(error);
            console.warn("Runtime valido solo in memoria:", error);
        }
    } catch (error) {
        clearTimeout(timeout);
        if (!attiva()) return;
        const motivo = controller.signal.aborted ? "Tempo massimo di caricamento superato." : messaggioErrore(error);
        if (erroreTrasporto) {
            let locale = null;
            try {
                locale = await storageRuntimeSillabe.leggiApprovato(attiva);
                if (!attiva()) return;
                if (locale) {
                    const dati = validaManifestSillabe(locale.manifest);
                    if (!dati.disponibile) throw new Error("Runtime locale non approvato.");
                    associa(locale.bytes, dati, "locale");
                    return;
                }
            } catch (erroreLocale) {
                if (!attiva()) return;
                if (locale) {
                    try { await storageRuntimeSillabe.scartaApprovato(locale.manifest, attiva); }
                    catch (erroreStorage) { console.warn("Runtime locale ignorato:", erroreStorage); }
                    if (!attiva()) return;
                }
                if (personale) return;
                statoRuntimeSillabe = { generazione, stato: "errore", manifest: null,
                    errore: `Runtime locale non disponibile: ${messaggioErrore(erroreLocale)}` };
                return;
            }
        }
        if (!personale) statoRuntimeSillabe = { generazione, stato: "errore", manifest, errore: `Runtime sillabico non disponibile: ${motivo}` };
    } finally {
        clearTimeout(timeout);
        // L'assenza/errori dei dati ufficiali non disabilita la stima nel personale.
        if (attiva() && personale && statoRuntimeSillabe.stato !== "pronto") {
            statoRuntimeSillabe = { generazione, stato: "pronto", manifest: null, errore: "", origine: "stima" };
        }
        aggiornaFiltroSillabe();
    }
}

function filtroSillabeDisponibile() {
    return statoRuntimeSillabe.generazione === generazioneMotore && motore !== null &&
        statoRuntimeSillabe.stato === "pronto";
}

function pulisciErroreSillabe() {
    erroreSillabe.hidden = true;
    erroreSillabe.textContent = "";
    minimoSillabe.setAttribute("aria-invalid", "false");
    massimoSillabe.setAttribute("aria-invalid", "false");
}

function aggiornaFiltroSillabe() {
    const disponibile = filtroSillabeDisponibile();
    if (!disponibile) {
        filtraSillabe.checked = false;
        pulisciErroreSillabe();
    }
    filtraSillabe.disabled = !disponibile || caricamentoInCorso;
    const intervallo = modalitaSillabe.value === "TRA";
    campiSillabe.hidden = !filtraSillabe.checked;
    campoMassimoSillabe.hidden = !intervallo;
    etichettaMinimoSillabe.textContent = intervallo ? "Minimo" : "Sillabe";
    modalitaSillabe.disabled = minimoSillabe.disabled = filtraSillabe.disabled || !filtraSillabe.checked;
    massimoSillabe.disabled = minimoSillabe.disabled || !intervallo;
    const stato = statoRuntimeSillabe.stato;
    statoSillabe.dataset.stato = stato;
    statoSillabe.textContent = disponibile
        ? `Filtro sillabico disponibile${statoRuntimeSillabe.origine === "locale" ? " offline" : ""}`
        : stato === "caricamento" ? "Caricamento dati sillabici..."
        : stato === "errore" ? "Errore caricamento dati sillabici"
        : "Filtro sillabico non disponibile";
    notaSillabe.hidden = vocabolarioAttivo?.modalita !== "personale";
    notaSillabe.textContent = statoRuntimeSillabe.origine === "stima"
        ? "Dati ufficiali non disponibili: viene usata una stima automatica, che puo' essere inesatta."
        : "Le parole senza dati sillabici ufficiali usano una stima automatica, che puo' essere inesatta.";
}

function leggiFiltroSillabe() {
    pulisciErroreSillabe();
    if (!filtraSillabe.checked) return null;
    if (!filtroSillabeDisponibile()) throw new Error("Filtro sillabico non disponibile.");
    if (!["ESATTAMENTE", "ALMENO", "AL_MASSIMO", "TRA"].includes(modalitaSillabe.value)) {
        throw new Error("Modalita' del filtro sillabico non valida.");
    }
    function invalido(campo, messaggio) {
        erroreSillabe.textContent = messaggio;
        erroreSillabe.hidden = false;
        campo.setAttribute("aria-invalid", "true");
        campo.focus();
        throw new Error(messaggio);
    }
    function numero(campo) {
        const testo = campo.value.trim();
        const valore = Number(testo);
        if (!/^[0-9]+$/.test(testo) || !Number.isInteger(valore) || valore < 1 || valore > 4294967295) {
            invalido(campo, "Inserisci un numero intero da 1 a 4294967295.");
        }
        return valore;
    }
    const minimo = numero(minimoSillabe);
    const massimo = modalitaSillabe.value === "TRA" ? numero(massimoSillabe) : minimo;
    if (minimo > massimo) invalido(massimoSillabe, "Il massimo deve essere maggiore o uguale al minimo.");
    return { modalita: modalitaSillabe.value, minimo, massimo };
}

function millisecondi(value) {
    return `${value.toFixed(1)} ms`;
}

function megabyte(bytes) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function dimensioneInTesto(bytes) {
    return `${bytes.toLocaleString("it-IT")} byte (${megabyte(bytes)})`;
}

function messaggioErrore(error) {
    if (typeof error === "string") {
        return error;
    }
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return "Errore durante l'operazione.";
}

function aggiornaNumeroParole() {
    conteggio.textContent = `${motore.numero_parole().toLocaleString("it-IT")} parole`;
}

function aggiornaIdentitaVocabolario() {
    if (!vocabolarioAttivo) {
        tipoVocabolario.textContent = "Nessun vocabolario";
        dettaglioVocabolario.textContent = "Non disponibile";
        return;
    }

    const personale = vocabolarioAttivo.modalita === "personale";
    riquadroVocabolario.dataset.modalita = personale ? "personale" : "originale";
    tipoVocabolario.textContent = personale ? "Vocabolario personale" : "Vocabolario originale";
    dettaglioVocabolario.textContent = personale
        ? `${vocabolarioAttivo.nomeBase} · Salvato su questo dispositivo`
        : `${nomeVocabolarioPredefinito} · Sola lettura`;
    aggiornaNumeroParole();
}

function aggiornaControlli() {
    const pronto = Boolean(motore && vocabolarioAttivo);
    const personaleAttivo = vocabolarioAttivo?.modalita === "personale";
    const personaleDisponibile = Boolean(vocabolarioPersonale);

    app.setAttribute("aria-busy", String(caricamentoInCorso));
    comando.disabled = caricamentoInCorso || !pronto;
    esegui.disabled = caricamentoInCorso || !pronto;
    fileVocabolario.disabled = caricamentoInCorso || !motore;
    usaOriginale.disabled = caricamentoInCorso || !motore || !personaleAttivo;
    creaPersonale.disabled = caricamentoInCorso || !pronto || personaleAttivo;
    usaPersonale.disabled = caricamentoInCorso || !personaleDisponibile || personaleAttivo;
    const esportazioneDisabilitata = caricamentoInCorso || !personaleAttivo;
    esportaPersonale.setAttribute("aria-disabled", String(esportazioneDisabilitata));
    esportaPersonale.tabIndex = esportazioneDisabilitata ? -1 : 0;
    eliminaPersonale.disabled = caricamentoInCorso || !personaleDisponibile;
    aggiornaPaginazione();
    aggiornaFiltroSillabe();
}

function impostaCaricamento(inCorso) {
    caricamentoInCorso = inCorso;
    aggiornaControlli();
}

function aggiornaMetriche({ lettura, core, totale, bytes }) {
    const memoriaWasmBytes = modulo.HEAPU8?.buffer?.byteLength;

    tempoLettura.textContent = millisecondi(lettura);
    tempoCore.textContent = millisecondi(core);
    tempoTotale.textContent = millisecondi(totale);
    dimensioneFile.textContent = dimensioneInTesto(bytes);
    memoriaWasm.textContent = memoriaWasmBytes ? megabyte(memoriaWasmBytes) : "Non disponibile";

    console.table({
        "Lettura base": millisecondi(lettura),
        "Caricamento e modifiche C++": millisecondi(core),
        "Totale": millisecondi(totale),
        "Dimensione base": `${bytes} byte`,
        "Parole caricate": motore.numero_parole(),
        "Memoria WebAssembly": memoriaWasmBytes ? megabyte(memoriaWasmBytes) : "Non disponibile",
    });
}

function mostraMessaggio(testo, classe = "messaggio-risultato") {
    if (ultimoRisultato?.haSnapshot) abbandonaRisultato();
    risultato.replaceChildren();
    const messaggio = document.createElement("p");
    messaggio.className = classe;
    messaggio.textContent = testo;
    risultato.append(messaggio);
    paginazione.hidden = true;
    paginaPrecedente.disabled = paginaSuccessiva.disabled = true;
    paginaPrecedente.onclick = paginaSuccessiva.onclick = null;
}

function vettoreInArray(vector) {
    const values = [];
    try {
        for (let i = 0; i < vector.size(); ++i) {
            values.push(vector.get(i));
        }
        return values;
    } finally {
        vector.delete();
    }
}

function creaVettore(values) {
    const vector = new modulo.StringVector();
    for (const value of values) {
        vector.push_back(value);
    }
    return vector;
}

function eseguiComandoStrutturato(testo, filtro = null) {
    abbandonaRisultato();
    const raw = filtro
        ? motore.avvia_comando_paginato_con_filtro_sillabe(testo,
            modulo.ModalitaFiltroSillabe[filtro.modalita], filtro.minimo, filtro.massimo)
        : motore.avvia_comando_paginato(testo);
    return {
        contestoRicerca: {
            comando: testo, filtro: filtro ? { ...filtro } : null,
            campi: { modalita: modalitaSillabe.value, minimo: minimoSillabe.value, massimo: massimoSillabe.value },
        },
        generazioneMotore,
        idSnapshot: raw.id_snapshot,
        haSnapshot: raw.ha_snapshot,
        totale: raw.totale,
        tipo: raw.tipo,
        footer: raw.footer,
        messaggio: raw.messaggio,
        parolaModificata: raw.parola_modificata,
        vocabolarioModificato: raw.vocabolario_modificato,
        richiedeSalvataggio: raw.richiede_salvataggio,
    };
}

function risultatoCorrente(stato) {
    return Boolean(stato && stato === ultimoRisultato &&
        stato.generazioneMotore === generazioneMotore && motore);
}

function abbandonaRisultato(stato = ultimoRisultato) {
    if (stato === ultimoRisultato) {
        ultimoRisultato = null;
        paginaCorrente = 0;
        parolaDaRimuovere = "";
        risultatoDaRimuovere = null;
        dialogoRimozione.close();
        risultato.replaceChildren();
        paginazione.hidden = true;
        paginaPrecedente.disabled = paginaSuccessiva.disabled = true;
        paginaPrecedente.onclick = paginaSuccessiva.onclick = null;
    }
    if (stato?.generazioneMotore === generazioneMotore && stato.haSnapshot && motore) {
        motore.libera_risultato(stato.idSnapshot);
    }
}

function sostituisciMotore(nuovoMotore) {
    if (nuovoMotore === motore) return;
    abbandonaRisultato();
    const precedente = motore;
    ++generazioneMotore;
    motore = nuovoMotore;
    if (precedente !== motoreSillabeUfficiale) precedente?.delete();
}

function leggiPaginaRisultato(stato, offset) {
    if (!risultatoCorrente(stato) || !stato.haSnapshot) return null;
    const raw = motore.leggi_pagina_risultato(stato.idSnapshot, offset, risultatiPerPagina);
    const righe = raw.righe;
    const parole = raw.parole_vocabolario;
    const converti = vector => {
        const values = [];
        for (let i = 0; i < vector.size(); ++i) values.push(vector.get(i));
        return values;
    };
    try {
        return { righe: converti(righe), paroleVocabolario: converti(parole) };
    } finally {
        try { righe.delete(); } finally { parole.delete(); }
    }
}

function aggiornaPaginazione() {
    const stato = ultimoRisultato;
    const attivo = risultatoCorrente(stato) && stato.haSnapshot;
    const totale = attivo ? stato.totale : 0;
    const pagine = Math.max(1, Math.ceil(totale / risultatiPerPagina));
    paginazione.hidden = !attivo || totale <= risultatiPerPagina;
    paginaPrecedente.disabled = caricamentoInCorso || !attivo || paginaCorrente === 0;
    paginaSuccessiva.disabled = caricamentoInCorso || !attivo || paginaCorrente >= pagine - 1;
    const inizio = totale ? paginaCorrente * risultatiPerPagina + 1 : 0;
    const fine = Math.min((paginaCorrente + 1) * risultatiPerPagina, totale);
    statoPagina.textContent = `Pagina ${paginaCorrente + 1} di ${pagine} · ${inizio}-${fine} di ${totale.toLocaleString("it-IT")} risultati`;
    paginaPrecedente.onclick = () => {
        if (risultatoCorrente(stato) && !paginaPrecedente.disabled) renderizzaRisultato(paginaCorrente - 1, stato);
    };
    paginaSuccessiva.onclick = () => {
        if (risultatoCorrente(stato) && !paginaSuccessiva.disabled) renderizzaRisultato(paginaCorrente + 1, stato);
    };
}

function apriConfermaRimozione(word, stato) {
    if (!risultatoCorrente(stato)) return;
    parolaDaRimuovere = word;
    risultatoDaRimuovere = stato;
    testoConfermaRimozione.textContent = `Vuoi davvero rimuovere '${word}' dal tuo vocabolario personale?`;
    dialogoRimozione.showModal();
    annullaRimozione.focus();
}

function renderizzaRisultato(pagina = 0, stato = ultimoRisultato) {
    if (stato && !risultatoCorrente(stato)) return;
    try {
        renderizzaPagina(pagina, stato);
    } catch (error) {
        if (!risultatoCorrente(stato)) return;
        abbandonaRisultato(stato);
        mostraMessaggio(`Errore durante la lettura dei risultati: ${messaggioErrore(error)}`);
    }
}

function renderizzaPagina(pagina, stato) {
    paginaCorrente = pagina;
    risultato.replaceChildren();

    if (!ultimoRisultato) {
        mostraMessaggio("Nessuna ricerca eseguita.");
        return;
    }
    if (ultimoRisultato.messaggio) {
        mostraMessaggio(ultimoRisultato.messaggio);
        return;
    }

    const totale = stato.totale;
    const pagine = Math.max(1, Math.ceil(totale / risultatiPerPagina));
    paginaCorrente = Math.min(Math.max(0, paginaCorrente), pagine - 1);
    const inizio = paginaCorrente * risultatiPerPagina;
    const datiPagina = stato.haSnapshot ? leggiPaginaRisultato(stato, inizio) : { righe: [], paroleVocabolario: [] };
    const personale = vocabolarioAttivo?.modalita === "personale";

    if (totale === 0 && !ultimoRisultato.footer) {
        const vuoto = document.createElement("p");
        vuoto.className = "messaggio-risultato";
        vuoto.textContent = "Nessun risultato.";
        risultato.append(vuoto);
    }

    for (let i = 0; i < datiPagina.righe.length; ++i) {
        const row = document.createElement("div");
        row.className = "riga-risultato";

        const testo = document.createElement("span");
        testo.className = "testo-risultato";
        testo.textContent = datiPagina.righe[i];
        row.append(testo);

        const word = datiPagina.paroleVocabolario[i] ?? "";
        if (personale && word) {
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "rimuovi-parola";
            remove.textContent = "−";
            remove.setAttribute("aria-label", `Rimuovi ${word} dal vocabolario personale`);
            remove.addEventListener("click", () => apriConfermaRimozione(word, stato));
            row.append(remove);
        }
        risultato.append(row);
    }

    if (ultimoRisultato.footer) {
        const footer = document.createElement("p");
        footer.className = "footer-risultati";
        footer.textContent = ultimoRisultato.footer;
        risultato.append(footer);
    }

    aggiornaPaginazione();
    risultato.scrollTop = 0;
}

async function caricaNelCore({ nomeBase, testo, datiOriginali, bytes, modalita, rimosse = [], aggiunte = [], ordinatoRimario = false, inizioTotale }) {
    const precedente = vocabolarioAttivo;
    let nuovoMotore = null;
    let generazionePubblicata = null;
    impostaCaricamento(true);
    statoVocabolario.dataset.stato = "caricamento";
    statoVocabolario.textContent = `Caricamento di ${nomeBase}...`;
    mostraMessaggio("Caricamento vocabolario...");

    try {
        if (modalita === "originale" ? !(datiOriginali instanceof Uint8Array) || !datiOriginali.byteLength
            : typeof testo !== "string" || testo.trim().length === 0) {
            throw new Error("Il vocabolario non contiene testo leggibile.");
        }

        const inizioCore = performance.now();
        nuovoMotore = new modulo.MotoreAnagrammi();
        if (modalita === "originale") {
            nuovoMotore.carica_vocabolario_ordinato_con_identita_da_bytes(datiOriginali);
        } else if (ordinatoRimario) {
            nuovoMotore.carica_vocabolario_ordinato_da_testo(testo);
        } else {
            nuovoMotore.carica_vocabolario_da_testo(testo);
        }
        if (rimosse.length || aggiunte.length) {
            const vettoreRimosse = creaVettore(rimosse);
            const vettoreAggiunte = creaVettore(aggiunte);
            try {
                nuovoMotore.applica_modifiche(vettoreRimosse, vettoreAggiunte);
            } finally {
                vettoreRimosse.delete();
                vettoreAggiunte.delete();
            }
        }
        nuovoMotore.imposta_sola_lettura(modalita === "originale");
        if (modalita === "personale") {
            if (motoreSillabeUfficiale) nuovoMotore.prepara_sillabe_personali_da_ufficiale(motoreSillabeUfficiale);
            else nuovoMotore.prepara_sillabe_personali();
        }
        const fineCore = performance.now();

        // Il vecchio motore resta intatto fino al completamento del nuovo caricamento.
        sostituisciMotore(nuovoMotore);
        nuovoMotore = null;
        generazionePubblicata = generazioneMotore;
        filtraSillabe.checked = false;

        vocabolarioAttivo = { modalita, nomeBase, bytes };
        if (modalita === "originale") bytesVocabolarioUfficiale = datiOriginali;
        statoRuntimeSillabe = { generazione: generazionePubblicata,
            stato: modalita === "originale" ? "caricamento" : "pronto", manifest: null, errore: "",
            origine: modalita === "personale" ? (motoreSillabeUfficiale ? "ufficiale" : "stima") : "" };
        ultimoRisultato = null;
        aggiornaIdentitaVocabolario();
        statoVocabolario.dataset.stato = "pronto";
        statoVocabolario.textContent = modalita === "personale"
            ? "Vocabolario personale pronto"
            : "Vocabolario originale pronto · sola lettura";
        mostraMessaggio("Nessuna ricerca eseguita.");
        aggiornaMetriche({
            lettura: inizioCore - inizioTotale,
            core: fineCore - inizioCore,
            totale: fineCore - inizioTotale,
            bytes,
        });
        return true;
    } catch (error) {
        statoVocabolario.dataset.stato = "errore";
        statoVocabolario.textContent = precedente
            ? "Caricamento non riuscito. Il vocabolario precedente resta selezionato."
            : "Nessun vocabolario disponibile";
        mostraMessaggio(`Errore nel caricamento del vocabolario: ${messaggioErrore(error)}`);
        return false;
    } finally {
        nuovoMotore?.delete();
        impostaCaricamento(false);
        if (vocabolarioAttivo) {
            comando.focus();
        }
        if (generazionePubblicata !== null) {
            void caricaRuntimeSillabe(generazionePubblicata);
        }
    }
}

async function usaVocabolarioOriginale(inizioTotale = performance.now()) {
    impostaCaricamento(true);
    try {
        const response = await fetch(percorsoVocabolarioPredefinito, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Errore HTTP ${response.status} durante il caricamento del vocabolario originale.`);
        }
        const datiOriginali = new Uint8Array(await response.arrayBuffer());
        return await caricaNelCore({
            nomeBase: nomeVocabolarioPredefinito,
            datiOriginali,
            bytes: datiOriginali.byteLength,
            modalita: "originale",
            ordinatoRimario: true,
            inizioTotale,
        });
    } catch (error) {
        statoVocabolario.dataset.stato = "errore";
        statoVocabolario.textContent = "Impossibile caricare il vocabolario originale";
        mostraMessaggio(messaggioErrore(error));
        return false;
    } finally {
        impostaCaricamento(false);
    }
}

async function usaVocabolarioPersonale() {
    impostaCaricamento(true);
    const inizio = performance.now();
    try {
        vocabolarioPersonale = await leggiVocabolarioPersonale();
        if (!vocabolarioPersonale) {
            throw new Error("Nessun vocabolario personale salvato in questo browser.");
        }
        return await caricaNelCore({
            nomeBase: vocabolarioPersonale.nomeBase,
            testo: vocabolarioPersonale.baseTesto,
            bytes: vocabolarioPersonale.baseBytes,
            modalita: "personale",
            rimosse: vocabolarioPersonale.rimosse,
            aggiunte: vocabolarioPersonale.aggiunte,
            ordinatoRimario: vocabolarioPersonale.ordinatoRimario === true,
            inizioTotale: inizio,
        });
    } catch (error) {
        statoVocabolario.dataset.stato = "errore";
        statoVocabolario.textContent = "Impossibile aprire il vocabolario personale";
        mostraMessaggio(messaggioErrore(error));
        return false;
    } finally {
        impostaCaricamento(false);
    }
}

async function creaCopiaPersonale(nomeBase, baseTesto, ordinatoRimario) {
    const ora = new Date().toISOString();
    const record = {
        versione: 1,
        nomeBase,
        baseTesto,
        baseBytes: new Blob([baseTesto]).size,
        rimosse: [],
        aggiunte: [],
        ordinatoRimario,
        creataIl: ora,
        aggiornataIl: ora,
    };
    await salvaVocabolarioPersonale(record);
    vocabolarioPersonale = record;
    aggiornaControlli();
    return record;
}

async function registraModifica(tipo, word) {
    if (!vocabolarioPersonale || vocabolarioAttivo?.modalita !== "personale") {
        throw new Error("Le modifiche sono consentite solo nel vocabolario personale.");
    }

    const rimosse = new Set(vocabolarioPersonale.rimosse);
    const aggiunte = new Set(vocabolarioPersonale.aggiunte);
    if (tipo === "aggiunta") {
        rimosse.delete(word);
        aggiunte.add(word);
    } else if (tipo === "rimozione") {
        aggiunte.delete(word);
        rimosse.add(word);
    } else {
        return;
    }

    const aggiornato = {
        ...vocabolarioPersonale,
        rimosse: [...rimosse],
        aggiunte: [...aggiunte],
        ordinatoRimario: tipo === "aggiunta" ? true : vocabolarioPersonale.ordinatoRimario === true,
        aggiornataIl: new Date().toISOString(),
    };
    await salvaVocabolarioPersonale(aggiornato);
    vocabolarioPersonale = aggiornato;
}

async function eseguiComando() {
    if (!motore || !vocabolarioAttivo || caricamentoInCorso) {
        return;
    }

    abbandonaRisultato();
    let filtro;
    try {
        filtro = leggiFiltroSillabe();
    } catch (error) {
        if (erroreSillabe.hidden) mostraMessaggio(messaggioErrore(error));
        return;
    }
    try {
        const risultatoComando = eseguiComandoStrutturato(comando.value, filtro);
        ultimoRisultato = risultatoComando;
        if (risultatoComando.vocabolarioModificato) {
            try {
                await registraModifica(risultatoComando.tipo, risultatoComando.parolaModificata);
            } catch (error) {
                if (!risultatoCorrente(risultatoComando)) return;
                await usaVocabolarioPersonale();
                throw new Error(`Modifica annullata: ${messaggioErrore(error)}`);
            }
        }

        if (!risultatoCorrente(risultatoComando)) return;
        aggiornaNumeroParole();
        renderizzaRisultato(0);
    } catch (error) {
        abbandonaRisultato();
        mostraMessaggio(filtro
            ? `Ricerca con filtro non riuscita. Verifica il comando; le modifiche + / - non sono ammesse con il filtro. ${messaggioErrore(error)}`
            : `Input non valido: ${messaggioErrore(error)}`);
    }

    comando.focus();
}

async function rimuoviParolaConfermata() {
    const word = parolaDaRimuovere;
    const stato = risultatoDaRimuovere;
    const contesto = stato?.contestoRicerca;
    const paginaDaRipristinare = paginaCorrente;
    dialogoRimozione.close();
    parolaDaRimuovere = "";
    if (!word || !risultatoCorrente(stato) || vocabolarioAttivo?.modalita !== "personale") {
        return;
    }

    impostaCaricamento(true);
    try {
        const esito = eseguiComandoStrutturato(`- ${word}`);
        ultimoRisultato = esito;
        if (!esito.vocabolarioModificato) {
            renderizzaRisultato(0);
            return;
        }
        try {
            await registraModifica(esito.tipo, esito.parolaModificata);
        } catch (error) {
            if (!risultatoCorrente(esito)) return;
            await usaVocabolarioPersonale();
            throw new Error(`Rimozione annullata: ${messaggioErrore(error)}`);
        }
        if (!risultatoCorrente(esito)) return;
        aggiornaNumeroParole();

        if (contesto) {
            filtraSillabe.checked = contesto.filtro !== null;
            modalitaSillabe.value = contesto.campi.modalita;
            minimoSillabe.value = contesto.campi.minimo;
            massimoSillabe.value = contesto.campi.massimo;
            aggiornaFiltroSillabe();
            ultimoRisultato = eseguiComandoStrutturato(contesto.comando, contesto.filtro);
            renderizzaRisultato(paginaDaRipristinare);
        } else {
            ultimoRisultato = esito;
            renderizzaRisultato(0);
        }
    } catch (error) {
        abbandonaRisultato();
        mostraMessaggio(messaggioErrore(error));
    } finally {
        impostaCaricamento(false);
    }
}

moduloRicerca.addEventListener("submit", (event) => {
    event.preventDefault();
    eseguiComando();
});

filtraSillabe.addEventListener("change", () => {
    pulisciErroreSillabe();
    aggiornaFiltroSillabe();
});
modalitaSillabe.addEventListener("change", () => {
    pulisciErroreSillabe();
    aggiornaFiltroSillabe();
});
minimoSillabe.addEventListener("input", pulisciErroreSillabe);
massimoSillabe.addEventListener("input", pulisciErroreSillabe);

esempiComando.forEach((esempio) => {
    esempio.addEventListener("click", () => {
        comando.value = esempio.dataset.comando ?? "";
        comando.focus();
    });
});

annullaRimozione.addEventListener("click", () => {
    parolaDaRimuovere = "";
    risultatoDaRimuovere = null;
    dialogoRimozione.close();
});
confermaEliminazione.addEventListener("click", rimuoviParolaConfermata);

usaOriginale.addEventListener("click", () => usaVocabolarioOriginale());
usaPersonale.addEventListener("click", usaVocabolarioPersonale);

creaPersonale.addEventListener("click", async () => {
    impostaCaricamento(true);
    try {
        if (vocabolarioPersonale && !window.confirm("Sostituire la copia personale esistente? Le sue modifiche verranno eliminate.")) {
            return;
        }
        const base = motore.esporta_vocabolario_testo();
        await creaCopiaPersonale(vocabolarioAttivo.nomeBase, base, true);
        await usaVocabolarioPersonale();
    } catch (error) {
        statoVocabolario.dataset.stato = "errore";
        statoVocabolario.textContent = "Impossibile creare la copia personale";
        mostraMessaggio(`Errore IndexedDB: ${messaggioErrore(error)}`);
    } finally {
        impostaCaricamento(false);
    }
});

fileVocabolario.addEventListener("change", async () => {
    const file = fileVocabolario.files?.[0];
    if (!file) {
        return;
    }

    impostaCaricamento(true);
    try {
        if (vocabolarioPersonale && !window.confirm("Sostituire la copia personale esistente con questo file? Le modifiche precedenti verranno eliminate.")) {
            return;
        }
        const testo = await file.text();
        if (!testo.trim()) {
            throw new Error("Il file selezionato e' vuoto.");
        }
        const importazione = new modulo.MotoreAnagrammi();
        let testoOrdinato;
        try {
            importazione.carica_vocabolario_da_testo(testo);
            testoOrdinato = importazione.esporta_vocabolario_testo();
        } finally {
            importazione.delete();
        }
        await creaCopiaPersonale(file.name, testoOrdinato, true);
        await usaVocabolarioPersonale();
    } catch (error) {
        statoVocabolario.dataset.stato = "errore";
        statoVocabolario.textContent = "Impossibile salvare il file come vocabolario personale";
        mostraMessaggio(`Errore IndexedDB: ${messaggioErrore(error)}`);
    } finally {
        fileVocabolario.value = "";
        impostaCaricamento(false);
    }
});

esportaPersonale.addEventListener("click", (event) => {
    if (vocabolarioAttivo?.modalita !== "personale" || caricamentoInCorso) {
        event.preventDefault();
        return;
    }
    if (urlEsportazione) {
        URL.revokeObjectURL(urlEsportazione);
    }
    const testo = motore.esporta_vocabolario_testo();
    urlEsportazione = URL.createObjectURL(new Blob([testo], { type: "text/plain;charset=utf-8" }));
    esportaPersonale.href = urlEsportazione;
});

eliminaPersonale.addEventListener("click", async () => {
    if (!window.confirm("Eliminare completamente il vocabolario personale salvato in questo browser?")) {
        return;
    }
    impostaCaricamento(true);
    try {
        await eliminaVocabolarioPersonale();
        vocabolarioPersonale = null;
        await usaVocabolarioOriginale();
    } catch (error) {
        statoVocabolario.dataset.stato = "errore";
        statoVocabolario.textContent = "Impossibile eliminare la copia personale";
        mostraMessaggio(`Errore IndexedDB: ${messaggioErrore(error)}`);
    } finally {
        impostaCaricamento(false);
    }
});

try {
    const inizioPagina = performance.now();
    const { default: createAnagrammiModule } = await import("./anagrammi.js");
    modulo = await createAnagrammiModule();
    sostituisciMotore(new modulo.MotoreAnagrammi());
    try {
        vocabolarioPersonale = await leggiVocabolarioPersonale();
    } catch (error) {
        console.warn("IndexedDB non disponibile:", messaggioErrore(error));
        vocabolarioPersonale = null;
    }
    impostaCaricamento(false);
    await usaVocabolarioOriginale(inizioPagina);
} catch (error) {
    sostituisciMotore(null);
    modulo = null;
    statoVocabolario.dataset.stato = "errore";
    statoVocabolario.textContent = "Impossibile inizializzare il modulo WebAssembly";
    mostraMessaggio(messaggioErrore(error));
    impostaCaricamento(false);
}

async function registraServiceWorker() {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator) ||
        !document.querySelector('meta[name="anagrammi-release"]')) return;
    try {
        await navigator.serviceWorker.register(new URL("./service-worker.js", document.baseURI), {
            scope: new URL("./", document.baseURI).pathname,
            updateViaCache: "none",
        });
    } catch (error) {
        console.warn("Offline Anagrammi non disponibile:", messaggioErrore(error));
    }
}

void registraServiceWorker();

window.addEventListener("beforeunload", () => {
    if (urlEsportazione) {
        URL.revokeObjectURL(urlEsportazione);
    }
    sostituisciMotore(null);
    motoreSillabeUfficiale?.delete();
    motoreSillabeUfficiale = null;
});
