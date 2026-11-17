Segretario MMG v0.16.3

- Setup: apre a fine installazione le estensioni Chrome e la home GitHub.
- Collegamento desktop Apri estensioni Chrome.
- Home GitHub: illustrazione MMG e istruzioni di trascinamento.

Segretario MMG v0.16.2

- Installer: attende solo il processo di installazione Ollama, non la successiva app tray.
- Avviso iniziale: Chrome chiuso fino al termine, download anche un ora o piu.
- Messaggi di avanzamento, timeout ed errori del processo installer verificati.

Segretario MMG v0.16.1

- Report diagnostico TXT locale in tutte le modalita: tempi, conteggi, eventi IA, retry.
- Nessuna copia del referto, valori, nomi file o URL nel report. Condivisione solo manuale.
- Indicazioni precise delle sezioni Eumed nella schermata iniziale e durante il lavoro.

Segretario MMG v0.16.0

- Build installer pilota in outputs; guida LEGGIMI-INSTALLER.md.
- Identita Chrome stabile tramite manifest.key, usata per OLLAMA_ORIGINS.
- installation-defaults.json permette al setup di impostare il primo modello,
  senza sovrascrivere la preferenza eventualmente gia' salvata nel profilo Chrome.
- Nessuna installazione di sistema eseguita durante la preparazione del pacchetto.

Segretario MMG v0.15.45

- Schermata iniziale: selezione Modello IA dall'elenco installato in Ollama,
  pulsante Aggiorna elenco e preferenza persistente nel profilo Chrome.
- Elenco letto tramite /api/tags e capacita' verificate tramite /api/show dal
  service worker locale. Nessun download o installazione automatica di modelli.
- Modello scelto usato in tutte le chiamate IA, inclusa lettura delle immagini.
- Modelli solo testo segnalati; invio di immagini bloccato con istruzioni chiare.
- Modelli di soli embedding e riferimenti cloud non utilizzati; motore resta locale.
- Modello precedente assente: fallback visibile al predefinito se installato,
  altrimenti al primo modello disponibile. Qualita' dei modelli alternativi da collaudare.
- Ollama non raggiungibile/elenco vuoto: messaggio esplicito e possibilita' di riprovare.
- Selezione bloccata durante elaborazione; nessuna modifica a parser, catalogo o writer.
- Verifiche: node --test tests/vaadin-regression.test.cjs tests/ollama-models.test.cjs

Segretario MMG v0.15.44

- Testi del pannello: Qwen sostituito con IA; OCR con Lettura rapida / Lettura con IA.
- Istruzioni iniziali semplificate; rimossa la frase sul pulsante Salva del gestionale.
- Riepilogo non prescritti concluso con invito a controllare i risultati in Eumed.
- Parte delle statistiche tecniche dei referti prescritti raccolta in Dettagli dell'analisi.
- Model ID, protocolli, parser, catalogo e comportamento dei pulsanti invariati.

Segretario MMG v0.15.43

- I frammenti di valore/unita'/range (es. mg/dL 66-100) non diventano esami
  sconosciuti. Test numerici verificano che glucosio e urea restino estratti.
- Creatinina urinaria per ACR solo quando il rapporto albumina/creatinina e'
  esplicitamente presente nello stesso piccolo blocco (non altrove nel referto).
- Rapporto U-albumina/U-creatinina riconosciuto anche con prefissi U ripetuti;
  resta distinto dalla creatinina e da verificare senza voce univoca nel catalogo.
- Riepilogo scrittura: aggiunti numero di retry, righe con retry e tempo totale
  di selezione catalogo per distinguere le cause dei rallentamenti.
- Nessuna riduzione delle attese e nessuna modifica ai pulsanti di conferma.

Segretario MMG v0.15.42

- Referti non prescritti: mapping FT3 esplicito al codice CVP 90.43.3_0,
  indipendente dalla grafia TRIODOTIRONINA del catalogo / TRIIODOTIRONINA del referto.
- Rapp. albumina-creatinina riconosciuto come rapporto ACR prima del mapping
  creatinina: non viene trattato come creatinina sierica o urinaria per ACR.
  Il rapporto resta da verificare se manca una voce catalogo univoca.
- eGFR segnalato come dato accessorio non inserito autonomamente, anziche'
  come esame sconosciuto. Il dato non viene salvato automaticamente altrove.
- Regressione sintetica: creatinina 60 umol/L e 0,68 mg/dL equivalenti,
  FT3 4,60 pmol/L con range 3,90-6,80, ACR mg/g separato dalla creatinina.
- Nessuna modifica al writer o alle righe gia' presenti in Eumed.

Segretario MMG v0.15.41

- Sinonimi sierici: kaliemia/kalemia/potassiemia, sodiemia/natremia/natriemia,
  cloremia, fosfatemia, azotemia, uricemia, sideremia; ALP ossea distinta da ALP totale.
- Sodiuria/natriuria, kaliuria/potassiuria, fosfaturia, magnesiuria, cloruria e uricosuria:
  voce urine semplice distinta dalla raccolta esplicita 24h, 24/h, 24 ore o delle 24 ore.
- Calciuria semplice: segnalazione esplicita da verificare. Il catalogo non contiene
  CALCIO [U] generico: non scegliere automaticamente I/II minzione o rapporto creatinina.
- Modifiche limitate al resolver di prescrizione; catalogo e writer invariati.

Segretario MMG v0.15.40

- Sinonimi prescrizione: calcemia -> calcio totale [S]; fosforemia -> fosfato [S];
  magnesemia -> magnesio totale [S]; ALP/ALP totale -> fosfatasi alcalina.
- Calciuria e fosfaturia con 24/h, 24h o 24 ore espliciti -> rispettive voci [U] 24H.
- Non forza questi mapping su calcio ionizzato, ALP ossea o urine estemporanee.
- Regressione sull'intera lista di 20 esami: verifica tutti i codici, non solo il conteggio.
- Catalogo e writer invariati rispetto alla v0.15.39.

Segretario MMG v0.15.39

- Prescrizione lista: percorso di selezione dedicato codice -> proposta visibile -> TAB.
- Con una sola proposta prova il TAB manuale; con piu' proposte clicca quella esatta.
- Se il TAB non acquisisce la voce, prova il click sulla vera voce di menu nella stessa
  ricerca, senza riscrivere il codice. Controlla chiusura popup e denominazione acquisita.
- Non usa proposte fuori schermo ne' il solo codice digitato come prova di selezione.
- Writer dei referti prescritti/non prescritti invariati. Velocita' e primo tentativo
  da verificare nella pagina Eumed; nessuna riduzione delle attese degli altri flussi.

Segretario MMG v0.15.38

- Lista prescrizione: glicemia/glucosio (anche basale/a digiuno) -> 90.27.1_2 GLUCOSIO [S].
- Il punteggio in creazione usa parole intere: glicemia non coincide piu' con ipoglicemia.
  Il matching di lettura dei referti mantiene il comportamento precedente.
- Il writer attende fino a 2,2 secondi il ritorno dei campi del form locale dopo ogni
  ricostruzione Vaadin. Se il form non torna, si ferma senza cercare pulsanti globali.
- Test di regressione sull'intera lista riportata: sette esami, sette mapping catalogo.

Segretario MMG v0.15.37

- Verifica righe prescrizione: riconosce anche gli alias catalogo Eumed (incluso TSH riflesso).
- Legge il testo delle singole celle separatamente e non richiede la classe row-has-data.
- Sinonimi solo per la prescrizione: glicata -> HbA1c; alanina amino transferasi -> ALT;
  aspartato amino transferasi -> AST. Albumina glicata rimane distinta.
- In caso di mancata verifica mostra conteggio TreeGrid prima/dopo e righe corrispondenti.
- Restano necessari crescita del totale e nuova evidenza corrispondente; nessun reinvio
  di una conferma dubbia nella stessa analisi. Collaudo reale su Eumed da completare.

Segretario MMG v0.15.36

- Baseline completa v0.15.35: work/baseline-v0.15.35.zip, con hash verificati.
- Non prescritti: vera proposta Vaadin obbligatoria anche per nomi e alias.
- Prescrizione lista: successo solo con aumento aria-rowcount e nuova riga corrispondente.
- Conteggio TreeGrid assente o esame gia' visibile: stop prima dell'inserimento.
- Conferma inviata ma non verificata: stop senza reinvio, anche ripremendo Compila nella stessa analisi.
- Catalogo branca 11 riconciliato con CVP e ACCORPAMENTI: 2452 codici; aggiunto COXIE e 5 alias ufficiali.
- Test locali: node --test tests/vaadin-regression.test.cjs
- Verifica catalogo: python tools/reconcile_lab_catalog.py "percorso/catalogo.xlsx"
- Dopo l'aggiornamento: Ricarica in chrome://extensions, poi Ctrl+Shift+R su Eumed.
- Non ricaricare durante inserimenti in corso: il tracking delle conferme e' in memoria.
- Collaudo reale su Eumed ancora necessario. La verifica piu' rigorosa puo' fermarsi
  se una nuova riga rimane fuori dalla finestra virtualizzata: controllarla prima di riprovare.

Segretario MMG v0.15.35

- Nuova terza modalità: PRESCRIVI ESAMI DA LISTA.
- Testo incollato: Qwen estrae soltanto gli esami richiesti e il catalogo locale valida/mappa ogni voce.
- PDF/JPEG/PNG: Qwen Vision analizza direttamente le immagini e riconosce X/spunte/croci; PaddleOCR non viene usato in questa modalità.
- Scrittura nella pagina Accertamenti: codice catalogo -> selezione reale Vaadin -> esenzione automatica -> priorità lasciata vuota -> conferma locale.
- Verifica tramite TreeGrid e retry controllati; nessun pulsante Ricette viene premuto.
- Mapping prescrizione sierologie: CMVAB, TOXOPAB, PARVOINF, Treponema 91.10.B_2, HIV 91.23.F_0, HBsAg 91.18.5_0, HBV reflex 91.18.6_0, HCV 91.19.5_0.

Segretario MMG v0.15.33

- Inserimento non prescritto: il FilterSelect Accertamento prova prima il CODICE catalogo CVP/Eumed (es. 90.38.4_0), richiedendo una vera proposta Vaadin da cliccare.
- Nome lungo e alias restano solo come fallback se il codice non produce proposte.
- Riduce i fallimenti con denominazioni lunghe/varianti (protidogramma, CEA, HbA1c, ecc.) senza modificare parser, Qwen, retry o Salva locale.

Segretario MMG v0.15.30

- HbA1c non prescritta: mapping deterministico al codice 90.28.1_0 invariato, ma il FilterSelect cerca prima la voce reale Eumed "Hb - EMOGLOBINA GLICATA".
- Per HbA1c il semplice testo digitato nel campo Accertamento non viene piu' considerato una selezione valida: deve essere trovata e cliccata una proposta reale della tendina.
- Retry 1+3, Salva locale deterministico e protezione anti-duplicato invariati.
- Nessuna modifica a parser/Qwen degli altri esami.


v0.15.30: CEA/CA15-3 deterministici, selezione reale CEA, LDL diretto da contesto, 1,25-vitamina D distinta, rumore Qwen residui soppresso.
v0.15.29: semantic rescue Qwen anche su AOU Padova, SYNLAB/Data Medica e ULSS6/Schiavonia. Qwen riceve solo le righe residue non spiegate dal parser; i risultati sono accettati solo se supportati dal testo residuo e poi risolti contro il catalogo Eumed. Riconoscimento Schiavonia esteso al nome esplicito del presidio.
