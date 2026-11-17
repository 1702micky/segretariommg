# Segretario MMG - setup pilota 0.16.13

Il file SegretarioMMG-Setup-0.16.13.exe e un installer unico Windows x64 che richiede elevazione UAC. E una build pilota compilata e controllata, NON ancora collaudata con installazione completa su un Windows pulito. Non e firmata digitalmente.

## Cosa fa

- Mostra RAM e percorso C:\AI\segretario-mmg-extension.
- Preseleziona Qwen3-VL 2B Instruct Q4 con meno di circa 12 GB; Qwen3.5 4B Q4 da circa 12 GB. Scelta sempre modificabile.
- Include PDF.js, PaddleOCR browser, modelli OCR e runtime WASM. Non richiede Node, npm o Python al collega.
- Scarica Ollama dal sito ufficiale se assente e controlla la firma Authenticode; scarica il modello scelto con ollama pull.
- Mantiene think:false nelle richieste; esegue un test IA sintetico senza dati clinici.
- Fissa l'identita Chrome dell'estensione con manifest.key. Configura OLLAMA_ORIGINS per quell'ID, preservando le origini gia configurate; limita OLLAMA_HOST a 127.0.0.1:11434 e riavvia Ollama.
- Salva backup dei file sostituiti e delle impostazioni Ollama precedenti in %LOCALAPPDATA%\SegretarioMMG.
- Installa un'attivita pianificata al LOGIN dell'utente (non prima del login). Avvia Ollama e controlla aggiornamenti se abilitati; una seconda attivita li ricontrolla ogni ora. L'attivita gira senza privilegi elevati.
- Verifica Ollama, modello, risposta IA, origine autorizzata, PaddleOCR (script esistente) e presenza dei parser PDF. Il test OCR e statico; non prova una vera inferenza OCR.
- Tenta di aprire chrome://extensions e mostra le istruzioni manuali. L'aggiunta dell'estensione rimane manuale.

## Come provarlo

A fine installazione, dopo la conferma del messaggio finale, il setup apre in Chrome la pagina delle estensioni e la home https://github.com/1702micky/segretariommg. GitHub non puo aprire direttamente indirizzi chrome://: nella guida l'indirizzo e disponibile da copiare e incollare.

Non avviare Chrome fino al messaggio finale di installazione completata. I download sono di diversi GB: con una connessione lenta possono richiedere anche un'ora o piu. Il setup attende la conclusione del solo programma di installazione Ollama, non la chiusura dell'app nella barra di Windows, e poi verifica il servizio locale. Non e piu necessario chiudere manualmente Ollama per sbloccare questo passaggio.

1. Prima prova su un altro PC o macchina virtuale con snapshot, senza dati clinici.
2. Chiudi Chrome e lavori IA in corso. Il setup si ferma se Chrome e aperto.
3. Avvia l'EXE e autorizza UAC con lo stesso utente amministratore che usa Chrome. Elevazione con un altro account non supportata.
4. Scegli modello e controllo aggiornamenti. Attendi download e verifiche: serve Internet e almeno 12 GB liberi su C:.
5. In Chrome attiva Modalita sviluppatore, Carica estensione non pacchettizzata, scegli C:\AI\segretario-mmg-extension.
6. Se gia installata una vecchia copia senza ID stabile, disattivala/rimuovila prima di aggiungere questa: non lasciare due copie attive.
7. Apri Eumed: controlla modello e prova prima una lista sintetica in sola analisi.
8. Riavvia Windows: verifica la partenza di Ollama e la permanenza dell'estensione, mantenendo Modalita sviluppatore attiva.

La RAM e un suggerimento, non una garanzia di prestazioni. Il setup non installa driver GPU. Mantiene eventuali altre origini Ollama, compreso un wildcard gia presente: controllare le impostazioni se si vuole restringere l'accesso.

## Aggiornamenti

Repository configurato: https://github.com/1702micky/segretariommg (pubblico, verificato accessibile; nessuna pubblicazione eseguita).

Per ogni futura versione stabile:
1. Incrementare manifest.version; mantenere manifest.key.
2. Eseguire python tools/build_installer.py.
3. Pubblicare una release GitHub vX.Y.Z e allegare esattamente segretario-mmg-update.zip generato per quella versione. Il solo ZIP automatico del repository non basta.
4. L'updater confronta la versione, richiede il digest SHA256 dell'asset restituito da GitHub, verifica tutti gli hash interni e l'ID. Non installa prerelease.
5. Applica soltanto a Chrome completamente chiuso, con backup e rollback sui file toccati se una copia fallisce. Se Chrome e aperto, rinvia: riprovare dal collegamento Aggiorna-Segretario o al controllo orario/login successivo.
6. Le preferenze di installazione e il modello scaricato non sono sovrascritti. Gli update non eseguono script scaricati: aggiornano solo la lista ammessa di file estensione e vendor. Per aggiornare installer/updater/Ollama occorre un nuovo setup o il percorso ufficiale Ollama.

SHA256 controlla integrita; la fonte di fiducia resta il repository GitHub HTTPS. Proteggere l'account GitHub. L'updater non effettua login GitHub e non funziona per repository privati.

## Doppia verifica effettuata

- Compilazione C# dell'EXE riuscita; script PowerShell analizzati senza eseguirli.
- Archivio costruito con lista esplicita: solo runtime; nessun PDF, XLSX, sn*.txt, log, test o backup personale.
- Rilettura indipendente e verifica SHA256 di ciascun file in archivio.
- Test automatici dell'estensione e dei modelli; controlli di sintassi JS.

## Disinstallazione

Rimuovi l'estensione da chrome://extensions, poi chiudi Chrome. In Impostazioni Windows > App > App installate cerca Segretario MMG e premi Disinstalla, oppure usa Disinstalla Segretario MMG nel menu Start. Richiede lo stesso account Windows usato per installare e la conferma amministratore.

Vengono rimossi solo i file registrati come installati, le attivita SegretarioMMG-Startup/Update, il collegamento Aggiorna-Segretario e la voce Windows. Le altre origini Ollama sono preservate; OLLAMA_HOST viene ripristinato solo se corrisponde ancora al valore impostato dal setup. Riavvia Ollama o Windows per applicare le impostazioni.

Ollama e i modelli IA restano installati. Log, backup e file aggiunti manualmente vengono conservati. Nessun dato Eumed viene modificato. Per aggiungere la disinstallazione alle installazioni precedenti serve eseguire il nuovo setup.

Verifiche automatiche su file sintetici: rifiuto di percorsi esterni e junction, conservazione dei file estranei e delle altre origini, nessuna rimozione ricorsiva della cartella del programma. Il flusso completo App installate/UAC richiede ancora una prova su Windows pulito.

## Limiti del collaudo

Non eseguiti: UAC/installazione reale, download Ollama/modelli, riavvio dei servizi, registrazione del task, installazione manuale Chrome, inferenza OCR reale, upgrade da una release GitHub pubblicata. Queste prove devono precedere la distribuzione ai colleghi.

Log setup e aggiornamenti: %LOCALAPPDATA%\SegretarioMMG. Il fallimento del setup lascia i file e backup per diagnosi; non effettua una disinstallazione globale automatica. Per fermare l'avvio automatico disabilitare le attivita SegretarioMMG-Startup e SegretarioMMG-Update in Utilita di pianificazione. Non cancellare Ollama o modelli se usati da altri programmi.

Download: MB ricevuti, totale e barra percentuale se la dimensione e comunicata dal server. Altrimenti vengono mostrati solo i MB ricevuti. Per ricevere questa nuova visualizzazione anche nel programma di aggiornamento, esegui il setup aggiornato.

## Interfaccia installer 0.16.13

Finestra grafica separata dal processo di lavoro: fase, tempo trascorso, indicatore animato e barra riferita al singolo download. Ollama e modello mostrano MB e totale quando disponibile; nelle attese la barra e animata. L'animazione indica che l'interfaccia e reattiva, non garantisce che un server remoto stia avanzando.

Il primo avviso richiede di salvare i lavori: dopo OK vengono chiusi forzatamente solo i processi Chrome del proprio account. Annulla non chiude Chrome. Il primo avvio Ollama viene nascosto tramite il marker upgraded usato dall'installer ufficiale; successivamente si usa il servizio serve nascosto. Nessuna modifica all'avvio di altri programmi.

Verificati compilazione e resa grafica della finestra senza avviare l'installazione, stream modello sintetici (successo, errore e interruzione), consenso e isolamento dei processi Chrome con mock. Serve ancora il collaudo completo su un PC di test.
