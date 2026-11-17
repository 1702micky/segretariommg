// Segretario MMG - background.js
// Versione 0.16.5
// Parla direttamente con Ollama locale via streaming NDJSON.

const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const REQUEST_TIMEOUT_MS = 6 * 60 * 1000; // 6 minuti per blocco/pagina
const modelInfoCache = new Map();

function isRemoteOllamaModel(model) {
  return Boolean(model?.remote_host || model?.remote_model || /(?::cloud$|-cloud(?::|$))/i.test(model?.name || ""));
}

async function ollamaMetadata(path, body) {
  const response = await fetch(`http://127.0.0.1:11434/api/${path}`, {
    method: body ? "POST" : "GET",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error(`Ollama: richiesta non riuscita (HTTP ${response.status}).`);
  return response.json();
}

async function listLocalOllamaModels() {
  const data = await ollamaMetadata("tags");
  if (!Array.isArray(data.models)) throw new Error("Elenco modelli non valido ricevuto da Ollama.");
  const unique = new Map();
  for (const model of data.models) {
    if (typeof model?.name !== "string" || !model.name.trim() || isRemoteOllamaModel(model)) continue;
    unique.set(model.name, { name: model.name, size: Number(model.size) || 0 });
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function getLocalOllamaModelInfo(name) {
  if (typeof name !== "string" || !name.trim()) throw new Error("Seleziona un modello IA.");
  const cached = modelInfoCache.get(name);
  if (cached && Date.now() - cached.at < 30000) return cached.info;
  const data = await ollamaMetadata("show", { model: name });
  if (isRemoteOllamaModel({ ...data, name })) throw new Error("Scegli un modello installato sul computer: i modelli cloud non sono utilizzati.");
  const capabilities = Array.isArray(data.capabilities) ? data.capabilities : null;
  const info = {
    name,
    completion: capabilities ? capabilities.includes("completion") : null,
    vision: capabilities ? capabilities.includes("vision") : null
  };
  modelInfoCache.set(name, { at: Date.now(), info });
  return info;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !["OLLAMA_LIST_MODELS", "OLLAMA_MODEL_INFO"].includes(message?.type)) return;
  const task = message.type === "OLLAMA_LIST_MODELS"
    ? listLocalOllamaModels().then(models => ({ models }))
    : getLocalOllamaModelInfo(message.model).then(info => ({ info }));
  task.then(result => respond({ ok: true, ...result })).catch(error => respond({
    ok: false,
    error: error?.name === "TypeError" || error?.name === "TimeoutError"
      ? "Ollama non risponde. Avvialo sul computer e premi Aggiorna elenco."
      : error?.message || "Impossibile leggere i modelli IA."
  }));
  return true;
});

// Un click sull'icona dell'estensione apre/chiude il pannello nella pagina.
chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;

  chrome.tabs.sendMessage(
    tab.id,
    { type: "SEGRETARIO_MMG_TOGGLE" },
    () => void chrome.runtime.lastError
  );
});

function startKeepAlive() {
  // Chrome MV3 può sospendere i service worker inattivi.
  // Durante una generazione lunga richiamiamo periodicamente
  // una API dell'estensione; inoltre lo stream invia messaggi
  // sul Port mentre Ollama genera.
  return setInterval(() => {
    chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError);
  }, 20_000);
}

async function ollamaStreamChat(payload, port, requestId, controller) {
  const keepAliveTimer = startKeepAlive();
  const timeoutTimer = setTimeout(() => controller.abort("timeout"), REQUEST_TIMEOUT_MS);

  let response;
  let reader;

  try {
    const modelInfo = await getLocalOllamaModelInfo(payload.model || "qwen3.5:4b");
    if (modelInfo.completion === false) throw new Error("Il modello selezionato non supporta l’analisi del testo. Scegli un modello di conversazione.");
    if ((payload.messages || []).some(message => message.images?.length) && modelInfo.vision === false) {
      throw new Error("Il modello selezionato legge soltanto testo. Per foto e PDF analizzati come immagini scegli un modello che supporti le immagini.");
    }
    response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify((() => {
        const body = {
          model: payload.model || "qwen3.5:4b",
          messages: payload.messages || [],
          stream: true,
          think: false,
          keep_alive: payload.keep_alive || "30m",
          options: {
            temperature: 0,
            num_predict: payload.num_predict || 900,
            ...(payload.options || {})
          }
        };

        // Per l'estrazione dei laboratori v0.8.4 usiamo un protocollo
        // tabellare, non JSON. OCR e altre chiamate possono invece
        // continuare a richiedere structured output esplicitamente.
        if (payload.format !== undefined && payload.format !== null) {
          body.format = payload.format;
        }

        return body;
      })())
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Ollama HTTP ${response.status}: ${errorText || response.statusText}`
      );
    }

    if (!response.body) {
      throw new Error("Ollama non ha restituito uno stream leggibile.");
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let buffer = "";
    let content = "";
    let lastProgressAt = 0;
    let chunksSeen = 0;
    let finalStats = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }

        if (event?.error) {
          throw new Error(`Ollama stream error: ${event.error}`);
        }

        chunksSeen += 1;

        const piece = event?.message?.content;
        if (typeof piece === "string") {
          content += piece;
        }

        if (event?.done) {
          finalStats = {
            total_duration: event.total_duration ?? null,
            load_duration: event.load_duration ?? null,
            prompt_eval_count: event.prompt_eval_count ?? null,
            eval_count: event.eval_count ?? null
          };
        }

        const now = Date.now();
        if (now - lastProgressAt >= 900) {
          lastProgressAt = now;
          try {
            port.postMessage({
              type: "OLLAMA_PROGRESS",
              requestId,
              chunksSeen,
              chars: content.length
            });
          } catch {}
        }
      }
    }

    // Eventuale ultima riga non terminata da newline.
    const tail = buffer.trim();
    if (tail) {
      let event = null;
      try { event = JSON.parse(tail); } catch {}

      if (event?.error) {
        throw new Error(`Ollama stream error: ${event.error}`);
      }

      const piece = event?.message?.content;
      if (typeof piece === "string") content += piece;
      if (event?.done) {
        finalStats = {
          total_duration: event.total_duration ?? null,
          load_duration: event.load_duration ?? null,
          prompt_eval_count: event.prompt_eval_count ?? null,
          eval_count: event.eval_count ?? null
        };
      }
    }

    if (!content.trim()) {
      throw new Error("IA ha restituito una risposta vuota.");
    }

    port.postMessage({
      type: "OLLAMA_RESULT",
      requestId,
      content,
      stats: finalStats
    });

  } catch (error) {
    let message;

    if (controller.signal.aborted) {
      message =
        controller.signal.reason === "timeout"
          ? "Timeout locale: IA non ha completato questo blocco entro 6 minuti."
          : "Richiesta Ollama annullata.";
    } else if (error instanceof TypeError && /fetch/i.test(String(error))) {
      message =
        "Il motore IA sul computer non risponde. " +
        "Verifica che Ollama sia avviato e riprova.";
    } else {
      message = error?.message || String(error);
    }

    try {
      port.postMessage({
        type: "OLLAMA_ERROR",
        requestId,
        message
      });
    } catch {}

  } finally {
    clearInterval(keepAliveTimer);
    clearTimeout(timeoutTimer);
    try { await reader?.cancel(); } catch {}
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "segretario-mmg-ollama") return;

  const controllers = new Map();

  port.onMessage.addListener((message) => {
    if (message?.type !== "OLLAMA_CHAT" || !message.requestId) return;

    const controller = new AbortController();
    controllers.set(message.requestId, controller);

    ollamaStreamChat(
      message.payload || {},
      port,
      message.requestId,
      controller
    ).finally(() => {
      controllers.delete(message.requestId);
    });
  });

  port.onDisconnect.addListener(() => {
    for (const controller of controllers.values()) {
      try { controller.abort("port_disconnected"); } catch {}
    }
    controllers.clear();
  });
});
