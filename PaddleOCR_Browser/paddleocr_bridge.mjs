import { PaddleOCR } from "@paddleocr/paddleocr-js";

export async function createSegretarioPaddleOCR(options = {}) {
  const ocr = await PaddleOCR.create({
    textDetectionModelName: "PP-OCRv6_tiny_det",
    textDetectionModelAsset: { url: options.detectionModelUrl },
    textRecognitionModelName: "PP-OCRv6_tiny_rec",
    textRecognitionModelAsset: { url: options.recognitionModelUrl },
    textDetectionBatchSize: 1,
    textRecognitionBatchSize: 8,
    ortOptions: {
      backend: "wasm",
      wasmPaths: options.wasmPaths,
      numThreads: 1,
      simd: true,
      proxy: false
    }
  });
  return ocr;
}
