# Sviluppo e distribuzione

La pagina iniziale è dedicata a chi usa il programma. Qui sono raccolti i riferimenti per chi lo mantiene.

## Test

```powershell
node --check segretario.js
node --check background.js
node --test tests/vaadin-regression.test.cjs tests/ollama-models.test.cjs tests/diagnostics.test.cjs
```

## Installer e release

Il workflow `.github/workflows/release.yml` prepara PDF.js e PaddleOCR, esegue i test, compila l’installer su Windows e pubblica gli asset della versione indicata in `manifest.json`. Non sovrascrive release esistenti.

Per una nuova versione incrementare `manifest.version` e mantenere `manifest.key`, necessario per preservare l’identità dell’estensione e la configurazione delle origini Ollama.

Build locale su Windows, con i runtime già presenti in `vendor`:

```powershell
python tools/build_installer.py
```

L’installer è una build pilota non firmata. I controlli automatici non sostituiscono il collaudo completo su Windows pulito. Consultare la [guida di installazione e collaudo](../installer/LEGGIMI-INSTALLER.md).

## Dati e file esclusi

Non caricare referti, dati dei pazienti, log clinici, copie di lavoro o backup. Usare fixture sintetiche per i test. `vendor`, `work` e `outputs` sono esclusi dal repository; gli eseguibili si distribuiscono nelle release.

## Immagini della pagina iniziale

Le immagini SVG sono illustrazioni dell’interfaccia, dichiarate come tali. Non rappresentano schermate di Eumed con dati reali. I testi vanno mantenuti coerenti con quelli dell’estensione.
