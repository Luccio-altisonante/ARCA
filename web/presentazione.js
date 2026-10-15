// Solo presentazione: le azioni sul vocabolario restano nell'app esistente.
const $ = selector => document.querySelector(selector);
const menu = $("#menu-navigazione");
const navigazione = $("#navigazione");
menu.addEventListener("click", () => {
    const aperto = menu.getAttribute("aria-expanded") !== "true";
    menu.setAttribute("aria-expanded", String(aperto));
    menu.setAttribute("aria-label", aperto ? "Chiudi navigazione" : "Apri navigazione");
    navigazione.dataset.aperto = String(aperto);
});
document.addEventListener("keydown", event => {
    if (event.key === "Escape" && menu.getAttribute("aria-expanded") === "true") {
        menu.click();
        menu.focus();
    }
});
document.querySelectorAll("[data-dialog]").forEach(link => {
    link.addEventListener("click", event => {
        event.preventDefault();
        const dialog = $("#" + link.dataset.dialog);
        dialog.addEventListener("close", () => {
            // Il link di apertura mobile e' nascosto dal menu chiuso.
            if (!link.getClientRects().length && menu.getAttribute("aria-expanded") !== "true") menu.click();
            link.focus();
        }, { once: true });
        if (menu.getAttribute("aria-expanded") === "true") menu.click();
        dialog.showModal();
    });
});

const guide = {
    assonanze: ["Assonanze", "Esplora un modello con ? e *. Le corrispondenze dipendono dalle lettere nelle posizioni indicate, non da un'analisi fonetica.", ["*a??a", "*e??e", "*o??o"]],
    rime: ["Rime", "Cerca parole con una terminazione scritta usando * all'inizio. La ricerca segue la grafia, non la pronuncia.", ["*are", "*ore", "*ello"]],
    consonanze: ["Consonanze", "Esplora le lettere con ? e *. La ricerca segue il modello scritto, non un'analisi fonetica.", ["c?s?", "p?rt?", "m?r?"]],
    anagrammi: ["Anagrammi", "Cerca gli anagrammi della parola. Aggiungi una lunghezza per usare solo parte delle lettere.", ["mare", "roma", "cartone 5"]],
};
const pannelloGuida = $("#guida-modalita");
const card = document.querySelectorAll("[data-guida]");
card.forEach(button => button.addEventListener("click", () => {
    const aperto = button.getAttribute("aria-expanded") !== "true";
    card.forEach(other => other.setAttribute("aria-expanded", String(other === button && aperto)));
    pannelloGuida.hidden = !aperto;
    if (!aperto) return;
    const [titolo, testo, esempi] = guide[button.dataset.guida];
    $("#titolo-guida").textContent = titolo;
    $("#testo-guida").textContent = testo;
    $("#esempi-guida").replaceChildren(...esempi.map(value => {
        const example = document.createElement("button");
        example.type = "button";
        example.className = "esempio-comando";
        example.textContent = value;
        example.disabled = $("#comando").disabled;
        example.addEventListener("click", () => {
            $("#comando").value = value;
            $("#comando").focus();
        });
        return example;
    }));
}));

const bannerPersonale = $("#onboarding-personale");
const azionePersonale = $("#onboarding-personale-azione");
const crea = $("#crea-personale");
const usa = $("#usa-personale");
function aggiornaPersonale() {
    bannerPersonale.hidden = $("#vocabolario-attivo").dataset.modalita === "personale";
    // Elimina e' abilitato anche con una copia inattiva: non confondere attesa e assenza.
    const esiste = !$("#elimina-personale").disabled || !usa.disabled;
    azionePersonale.textContent = esiste ? "Usa copia personale" : "Crea copia personale";
    azionePersonale.disabled = (esiste ? usa : crea).disabled;
    azionePersonale.dataset.azione = esiste ? "usa" : "crea";
    $("#esempi-guida").querySelectorAll("button").forEach(button => {
        button.disabled = $("#comando").disabled;
    });
}
azionePersonale.addEventListener("click", () => {
    (azionePersonale.dataset.azione === "usa" ? usa : crea).click();
});
const osservatore = new MutationObserver(aggiornaPersonale);
osservatore.observe($("#vocabolario-attivo"), { attributes: true, attributeFilter: ["data-modalita"] });
[crea, usa, $("#elimina-personale"), $("#comando")].forEach(element => {
    osservatore.observe(element, { attributes: true, attributeFilter: ["disabled"] });
});
aggiornaPersonale();

const bannerInstallazione = $("#onboarding-installazione");
const installa = $("#installa-arca");
const standalone = window.matchMedia("(display-mode: standalone)");
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
let promptInstallazione = null;
let installata = Boolean(navigator.standalone || standalone.matches);
let chiuso = false;
function aggiornaInstallazione() {
    bannerInstallazione.hidden = installata || standalone.matches || chiuso || (!promptInstallazione && !ios);
}
window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    promptInstallazione = event;
    aggiornaInstallazione();
});
window.addEventListener("appinstalled", () => {
    installata = true;
    promptInstallazione = null;
    aggiornaInstallazione();
});
standalone.addEventListener("change", aggiornaInstallazione);
$("#chiudi-installazione").addEventListener("click", () => {
    chiuso = true;
    aggiornaInstallazione();
});
installa.addEventListener("click", async () => {
    if (!promptInstallazione) {
        if (ios) $("#guida-installazione").showModal();
        return;
    }
    const prompt = promptInstallazione;
    promptInstallazione = null;
    installa.disabled = true;
    try {
        await prompt.prompt();
        await prompt.userChoice;
    } catch {
        // Nessuna installazione simulata: attendiamo un eventuale nuovo evento del browser.
    } finally {
        installa.disabled = false;
        aggiornaInstallazione();
    }
});
aggiornaInstallazione();

const statoCoola = $("#stato-coola");
const raccoltaCoola = $("#raccolta-coola");
let caricamentoCoola = null;
$("#apri-coola").addEventListener("click", () => {
    if (caricamentoCoola) return;
    statoCoola.hidden = false;
    statoCoola.textContent = "Caricamento della raccolta...";
    caricamentoCoola = (async () => {
        try {
            const response = await fetch(new URL("./data/coola.json", import.meta.url));
            if (!response.ok) throw new Error("Raccolta non disponibile");
            const data = await response.json();
            if (data?.schema !== 1 || !Array.isArray(data.items) || !data.items.length ||
                !data.items.every(item => Array.isArray(item?.forme) && item.forme.length >= 2 &&
                    item.forme.every(forma => typeof forma === "string" && forma.trim().length > 0))) {
                throw new Error("Raccolta non valida");
            }
            const gruppi = data.items.map(item => {
                const gruppo = document.createElement("li");
                gruppo.className = "coola-gruppo";
                item.forme.forEach((forma, index) => {
                    if (index) {
                        const separatore = document.createElement("span");
                        separatore.className = "coola-scambio";
                        separatore.setAttribute("aria-hidden", "true");
                        separatore.textContent = "⇄";
                        gruppo.append(separatore);
                    }
                    const testo = document.createElement("span");
                    testo.className = "coola-forma";
                    testo.textContent = forma;
                    gruppo.append(testo);
                });
                return gruppo;
            });
            raccoltaCoola.replaceChildren(...gruppi);
            statoCoola.hidden = true;
        } catch {
            raccoltaCoola.replaceChildren();
            statoCoola.textContent = "La raccolta CoolA non è disponibile in questo momento.";
            caricamentoCoola = null;
        }
    })();
});
