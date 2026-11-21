# Intervalli IA uniformati - 0.16.28

I flussi con e senza prescrizioni usano buildReferenceIntervalPrompt(), un unico contratto per min/max numerici. Per <200 il minimo e vuoto e il massimo 200; per >40 il minimo e 40 e il massimo vuoto. Sono esplicitati <=, >=, ≤, ≥, unita, intervalli bilaterali, fasce multiple e divieto di inventare zero o scambiare soglia e risultato. Rimossa dal flusso senza prescrizioni la richiesta limitata ai soli intervalli bilaterali. I controlli sorgente restano applicati.

Verifica: 124 test Node superati. Prova sintetica Ollama Qwen3.5 4B con gli stessi nove risultati del benchmark 0.16.27: con prescrizioni 9/9 valori, 9/9 intervalli e data corretta (87,2 s); senza prescrizioni 9/9 valori, 8/9 intervalli e data corretta (87,0 s). Prima erano rispettivamente 8/9 e 3/9 intervalli. Una singola ripetizione dimostra il caso corretto ma non una percentuale generale di accuratezza. Nessuna scrittura in Eumed. Nessun addestramento dei pesi del modello.
