(() => {
  "use strict";

  let ocrPromise = null;
  let currentOptionsKey = "";

  function serializeError(error) {
    return {
      message: error?.message || String(error),
      stack: error?.stack || ""
    };
  }

  function sanitizeResult(result) {
    const first = Array.isArray(result) ? result[0] : null;
    if (!first) return [];

    const items = Array.isArray(first.items)
      ? first.items.map(item => ({
          text: String(item?.text || ""),
          score: Number(item?.score ?? 0),
          poly: Array.isArray(item?.poly)
            ? item.poly.map(p => [Number(p?.[0] ?? 0), Number(p?.[1] ?? 0)])
            : []
        }))
      : [];

    return [{
      items,
      metrics: {
        totalMs: Number(first?.metrics?.totalMs ?? 0),
        detMs: Number(first?.metrics?.detMs ?? 0),
        recMs: Number(first?.metrics?.recMs ?? 0)
      }
    }];
  }

  async function ensureOcr(options) {
    const key = JSON.stringify(options || {});
    if (ocrPromise && key === currentOptionsKey) return ocrPromise;

    currentOptionsKey = key;
    ocrPromise = (async () => {
      const factory = globalThis.SegretarioPaddleOCRBundle?.createSegretarioPaddleOCR;
      if (typeof factory !== "function") {
        throw new Error(
          "Bundle PaddleOCR sandbox non inizializzato: createSegretarioPaddleOCR assente."
        );
      }
      return factory(options || {});
    })();

    try {
      return await ocrPromise;
    } catch (error) {
      ocrPromise = null;
      currentOptionsKey = "";
      throw error;
    }
  }

  window.addEventListener("message", event => {
    // La sandbox ha origine opaca ("null"); validiamo quindi il parent
    // e trasferiamo subito la comunicazione su un MessagePort dedicato.
    if (event.source !== parent) return;
    if (event.data?.type !== "SEGRETARIO_PADDLE_CONNECT") return;

    const port = event.ports?.[0];
    if (!port) return;

    const initOptions = event.data?.options || {};

    port.onmessage = async messageEvent => {
      const message = messageEvent.data || {};
      const id = message.id;

      try {
        if (message.type === "INIT") {
          await ensureOcr(initOptions);
          port.postMessage({ type: "READY", id });
          return;
        }

        if (message.type === "PREDICT") {
          const ocr = await ensureOcr(initOptions);

          const bytes = message.bytes;
          if (!(bytes instanceof ArrayBuffer)) {
            throw new Error("Immagine OCR non valida: ArrayBuffer mancante.");
          }

          const blob = new Blob([bytes], {
            type: message.mime || "image/jpeg"
          });

          const result = await ocr.predict(blob, message.options || {});
          port.postMessage({
            type: "RESULT",
            id,
            result: sanitizeResult(result)
          });
          return;
        }

        if (message.type === "PING") {
          port.postMessage({ type: "PONG", id });
        }
      } catch (error) {
        port.postMessage({
          type: "ERROR",
          id,
          error: serializeError(error)
        });
      }
    };

    port.start?.();
  });
})();
