// Serve the English recognizer from this site, including the portable fallback for browsers without SIMD.
import { copyFile, mkdir } from 'node:fs/promises';
const target = new URL('../public/ocr/6.0.1/', import.meta.url);
await mkdir(target, { recursive: true });
const files = {
  'tesseract.min.js': 'tesseract.js/dist/tesseract.min.js',
  'tesseract.min.js.LICENSE.txt': 'tesseract.js/dist/tesseract.min.js.LICENSE.txt',
  'worker.min.js': 'tesseract.js/dist/worker.min.js',
  'worker.min.js.LICENSE.txt': 'tesseract.js/dist/worker.min.js.LICENSE.txt',
  'engine-license.txt': 'tesseract.js/LICENSE.md',
  'core-license.txt': 'tesseract.js-core/LICENSE',
  'tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'eng.traineddata.gz': '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  'language-package.json': '@tesseract.js-data/eng/package.json',
};
await Promise.all(Object.entries(files).map(([name, source]) =>
  copyFile(new URL('../node_modules/' + source, import.meta.url), new URL(name, target))));
