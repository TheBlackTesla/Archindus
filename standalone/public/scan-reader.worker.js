// Keeping the recognizer and its child worker in this job lets Cancel release both during startup or recognition.
self.onmessage = async ({data: image}) => {
  const assets = new URL('/ocr/6.0.1/', self.location.origin).href;
  let reader;
  try {
    importScripts(assets + 'tesseract.min.js');
    reader = await self.Tesseract.createWorker('eng', self.Tesseract.OEM.LSTM_ONLY, {
      workerPath: assets + 'worker.min.js',
      corePath: assets,
      langPath: assets,
      workerBlobURL: false,
      cacheMethod: 'none',
      logger: ({status, progress}) => {
        if (status === 'recognizing text') self.postMessage({type: 'progress', progress});
      },
      errorHandler: () => self.postMessage({type: 'error'}),
    });
    const {data} = await reader.recognize(image);
    self.postMessage({type: 'text', text: data.text});
  } catch {
    self.postMessage({type: 'error'});
  } finally {
    if (reader) await reader.terminate();
  }
};
