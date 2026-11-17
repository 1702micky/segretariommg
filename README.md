# Segretario MMG

Assistente locale per referti e liste di esami nel gestionale Eumed, su Windows e Chrome.

## Download

Scaricare installer e istruzioni dalla [release 0.16.0](https://github.com/1702micky/segretariommg/releases/tag/v0.16.0).

Build pilota non firmata: collaudare su un Windows di prova prima della distribuzione generale. Chiudere Chrome prima del setup. Estensione caricata manualmente in modalita sviluppatore.

## Sviluppo e distribuzione

- `node --test tests/vaadin-regression.test.cjs tests/ollama-models.test.cjs`
- `python tools/build_installer.py` su Windows con runtime PDF/OCR in vendor.
- Il workflow release prepara le dipendenze, esegue i test, compila il setup e pubblica la versione indicata da manifest.json. Non sovrascrive release esistenti.
- Per una nuova release incrementare manifest.version conservando manifest.key.
- Guida: installer/LEGGIMI-INSTALLER.md.

L'IA usa Ollama locale con think:false. Nessun referto o dato personale deve essere inserito nel repository.
