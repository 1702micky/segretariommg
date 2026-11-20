# Modifiche IA P0/P1 - 0.16.26

Sono implementate le priorita P0/P1 del rapporto tecnico del 20 novembre 2026. Le priorita P2 (nuova campagna di benchmark e scelta del modello predefinito) restano escluse.

## Compatibilita no-thinking (P0)

Il service worker legge /api/show, segnala Thinking/Instruct e impedisce l'uso dei modelli riconosciuti come thinking-only. La selezione esegue una richiesta JSON sintetica di 128 token con think:false, timeout di 60 secondi e cache di 30 minuti legata ai metadati. Questo controllo verifica la compatibilita tecnica, non la qualita clinica. Ogni richiesta effettiva continua a usare think:false e interrompe lo stream se arriva message.thinking, anche nell'ultimo evento senza newline. L'installer mantiene il modello piccolo Instruct.

## Selezione delle prescrizioni (P0)

Le liste testuali richiedono nome e marcatura nella stessa voce, con separazione delle caselle sulla stessa riga. Le liste semplici restano utilizzabili senza marcature. Per le immagini viene eseguita una seconda verifica visiva sulla stessa immagine: ogni candidato ha un indice vincolato e deve essere confermato. Incertezza, casella vuota, indice duplicato o etichetta discordante escludono la voce e producono un avviso. La seconda lettura aumenta il tempo delle sole liste visuali; due letture dello stesso modello possono condividere errori, quindi non costituiscono una garanzia universale sulle immagini.

## Estrazione e associazione (P1)

I contratti JSON numerici richiedono line_start e line_end. Prima di associare il target si ricostruisce dal testo originale un blocco di massimo quattro righe: nome, valore e unita devono essere compatibili con la stessa misurazione. La prova sorgente conserva numeri di riga e citazione immutabile; evidence rimane testo per compatibilita con anteprima e scrittura. Se la IA riscrive il nome ma indica una riga con valore/unita esatti, il nome viene ricavato dalla riga stessa. Il target proposto dalla IA passa successivamente i controlli esistenti di concetto, matrice, unita e disponibilita nella griglia. Si mantengono una sola chiamata IA per batch e l'astensione sulle prove insufficienti.

Nei referti senza prescrizione lo stesso controllo precede la risoluzione del catalogo. I vecchi array restano leggibili, ma devono comunque superare la prova sul testo. I referti complessi conservano il protocollo dei blocchi di righe.

## Limiti, date e urine (P1)

Min/max sono verificati separatamente dal valore. Un intervallo non supportato viene svuotato e segnalato; il recupero successivo dall'evidenza non puo ripristinarlo. Intervalli con piu fasce o con un altro esame sulla stessa riga non vengono accettati automaticamente. Date europee/ISO vengono normalizzate e devono corrispondere alla data di refertazione/firma citata nel testo; nascita e accettazione non sono usate.

Microalbuminuria con concentrazione urinaria mg/L (anche mg/dL o ug/mL) puo superare la convalida specifica senza abilitare mg/L per un rapporto albumina/creatinina. Matrice urinaria e sierica restano distinte. I riferimenti alla creatinina urinaria sono 90.16.3_7 per calcolo ACR e 90.16.3_3 per 24 ore, verificati nel catalogo; non sono numeri di versione del software.

## Verifiche e limiti

- 121 test Node: regressioni precedenti e nuove prove su thinking, JSON, caselle vuote, evidenze, etichette riscritte, date, intervalli e matrice urinaria.
- Test isolati dell'installer: attesa processi, disinstallazione, progressi download e interfaccia, senza installare o rimuovere software.
- Ollama reale, fixture sintetica di tre esami (AST, ALT, microalbuminuria), data e intervalli: Qwen3.5 4B ha restituito 3/3 risultati verificabili e la data corretta. Lista con AST/GGT spuntati e ALT vuoto: 2/2 richiesti, nessuna casella vuota accettata. Circa 40 secondi complessivi, inclusa verifica modello e due analisi: non e una misura separata del throughput.
- Il 2B Instruct ha superato la compatibilita JSON e la lista, ma ha ancora prodotto etichette/blocchi e citazione della data non conformi nel referto: 0/3 numerici accettati nella prova. Questo limite resta esplicito; non viene aggirato abbassando la convalida.
- Nessuna interazione clinica in Eumed. Queste prove verificano il codice e casi sintetici, non stabiliscono una percentuale generale di accuratezza.

- Prova visiva reale finale con Qwen3.5 4B: immagine sintetica con AST/GGT spuntati e ALT vuoto, 2/2 selezioni confermate e nessuna vuota accettata, circa 18,5 secondi inclusa verifica modello. Il primo contratto con booleano piu marcatore produceva risposte contraddittorie; sostituito con un unico stato enumerato.

## Completamento 0.16.27

La verifica reale del percorso senza prescrizioni ha evidenziato una lettura di line_end come estremo escluso (1/2 per una sola riga). Il prompt ora richiede esplicitamente estremi inclusivi e cita l'esempio 2/2. Dopo la modifica, Qwen3.5 4B ha fornito 2/2 risultati sintetici verificabili, con intervalli e senza referti complessi inventati. La citazione della data conservava il prefisso artificiale [L3]: il validatore ora lo rimuove solo dopo aver verificato numero e contenuto della riga. Test dedicato anche per un prefisso riferito alla riga sbagliata. Totale aggiornato: 122 test Node.

Nella ripetizione finale con prompt inclusivo, anche Qwen3-VL 2B Instruct ha restituito 3/3 valori e intervalli verificabili nel percorso con prescrizioni e 2/2 voci selezionate nella lista. La citazione della data del 2B resta non conforme e viene scartata. Il precedente 0/3 descrive la prova prima di questa correzione, non l'esito finale.
