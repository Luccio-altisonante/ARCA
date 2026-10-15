# Asset ARCA

L'identita' visuale ARCA e' ideata e diretta per il progetto da Luca Montanelli.
Strumenti generativi OpenAI sono stati usati come ausilio per alcuni asset,
non come autori o titolari del progetto ARCA.

`hero-toscana-preview.png` e' il paesaggio generato con lo strumento ImageGen
integrato e usato nello sfondo attuale. Non e' una fotografia documentaria.
Non contiene testi, pannelli o screenshot dell'interfaccia.

Prompt: costa mediterranea toscana al tramonto, mare blu calmo, cielo chiaro
con nuvole calde, sole basso a sinistra, rocce e vegetazione salvia, piccola
silhouette marittima con struttura ad albero all'estrema destra; composizione
aperta per l'interfaccia, luce naturale editoriale, nessun testo/logo/UI.
Riferimento esclusivamente atmosferico: mockup ARCA approvato dall'autore.

Lo sfondo si sostituisce tramite `--hero-background` in `web/style.css`;
ogni nuovo asset deve entrare nell'inventario immutabile di `web/build.ps1`.
Il file e' locale e disponibile offline con la shell.

Icone PWA e favicon approvate sono integrate in `web/assets/icons/`, nel manifest
e nell'inventario immutabile della shell. Questa documentazione non modifica
i byte di alcun asset.
