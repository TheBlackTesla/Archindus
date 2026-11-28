'use client';
import {useEffect, useId, useRef, useState} from 'react';
import {openPdf} from '../archindus/document-tools';
import type {Attachment} from '../archindus/artifacts';
import {documentPages, MAX_REVIEW_CHARS, needsTranscription} from '../../lib/document-pages';

type Props = {
  file: File;
  url: string;
  attachment: Attachment;
  disabled: boolean;
  onApply: (page: number, text: string) => boolean;
  onClose: () => void;
};

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob =>
    blob ? resolve(blob) : reject(Error('Could not read the page image.')), 'image/png'));
}

async function recognize(canvas: HTMLCanvasElement, signal: AbortSignal, update: (message: string) => void) {
  const image = await canvasBlob(canvas);
  signal.throwIfAborted();
  const worker = new Worker('/scan-reader.worker.js');
  let timeout: number | undefined;
  let stop: (() => void) | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      const failure = () => reject(Error('Recognition could not finish. Try again or type the text from the original page.'));
      stop = () => reject(signal.reason);
      timeout = window.setTimeout(failure, 120_000);
      signal.addEventListener('abort', stop, {once: true});
      worker.onerror = failure;
      worker.onmessage = ({data}) => {
        if (data.type === 'progress') update('Reading text · ' + Math.round(data.progress * 100) + '%');
        else if (data.type === 'text') resolve(String(data.text).trim());
        else failure();
      };
      worker.postMessage(image);
    });
  } finally {
    window.clearTimeout(timeout);
    if (stop) signal.removeEventListener('abort', stop);
    worker.terminate();
  }
}

export function ScanReview({file, url, attachment, disabled, onApply, onClose}: Props) {
  const pages = documentPages(attachment).filter(item => item.eligible);
  const first = pages.find(item => !item.reviewed) ?? pages[0];
  const [number, setNumber] = useState(first.page);
  const page = pages.find(item => item.page === number)!;
  const saved = page.reviewed ? page.text : '';
  const [draft, setDraft] = useState(saved);
  const [status, setStatus] = useState('');
  const [ready, setReady] = useState(false);
  const [reading, setReading] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const active = useRef<AbortController | null>(null);
  const id = useId();
  useEffect(() => {
    const control = new AbortController();
    const target = canvas.current!;
    let task: Awaited<ReturnType<typeof openPdf>> | undefined;
    setReady(false);
    setStatus('Opening original page…');
    const render = async () => {
      task = await openPdf(file);
      try {
        if (control.signal.aborted) return;
        const pdf = await task.promise;
        const original = await pdf.getPage(number);
        if (control.signal.aborted) return;
        const size = original.getViewport({scale: 1});
        const scale = Math.min(2.75, 2600 / Math.max(size.width, size.height), Math.sqrt(3_000_000 / (size.width * size.height)));
        const viewport = original.getViewport({scale});
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        await original.render({canvas: target, viewport, background: 'white'}).promise;
        if (!control.signal.aborted) { setReady(true); setStatus(''); }
      } finally {
        await task.destroy();
      }
    };
    void render().catch(() => {
      if (!control.signal.aborted) setStatus('The preview could not open. Open the original PDF and type a transcription below.');
    });
    return () => {
      control.abort();
      if (task) void task.destroy().catch(() => {});
      active.current?.abort();
    };
  }, [file, number]);

  function choose(next: number) {
    if (draft !== saved && !window.confirm('Discard the unconfirmed text for this page?')) return;
    const item = pages.find(p => p.page === next)!;
    setNumber(next);
    setDraft(item.reviewed ? item.text : '');
  }

  async function readText() {
    if (!canvas.current || !ready || active.current) return;
    if (draft && !window.confirm('Replace the text in the editor with a fresh transcription?')) return;
    const control = new AbortController();
    active.current = control;
    setReading(true);
    setStatus('Loading the English text recognizer…');
    try {
      const text = await recognize(canvas.current, control.signal, setStatus);
      if (!control.signal.aborted) {
        setDraft(text);
        setStatus(text ? 'Check the wording and numbers against the original page before using this text.' : 'No text was found. You can type what is visible on the page.');
      }
    } catch (error) {
      if (!control.signal.aborted) setStatus(error instanceof Error ? error.message : 'Recognition failed. You can type the page text.');
    } finally {
      if (active.current === control) {
        active.current = null;
        if (!control.signal.aborted) setReading(false);
      }
    }
  }

  return <section className="work-scan" aria-labelledby={id+'-heading'}>
    <div className="work-brief-head"><h2 id={id+'-heading'}>Review scanned pages</h2><button type="button" onClick={()=>{
      if (draft === saved || window.confirm('Discard the unconfirmed text for this page?')) onClose();
    }}>Close review</button></div>
    <p>{file.name}</p>
    <label htmlFor={id+'-page'}>Scanned page</label>
    <select id={id+'-page'} disabled={reading||disabled} value={number} onChange={e=>choose(Number(e.target.value))}>
      {pages.map(p=><option key={p.page} value={p.page}>Page {p.page} · {p.reviewed?'reviewed':'needs review'}</option>)}
    </select>
    <div className="work-scan-grid">
      <div><a href={url+'#page='+number} target="_blank" rel="noopener noreferrer">Open original PDF at page {number}</a>
        <canvas key={number} ref={canvas} hidden={!ready} role="img" aria-label={'Original scan, page '+number}/></div>
      <div><p>Read this page on your device or enter its text. Check names, numbers and conditions before adding it to the evidence.</p>
        {reading?<button type="button" onClick={()=>{active.current?.abort();active.current=null;setReading(false);setStatus('Recognition stopped.')}}>Stop reading</button>
          :<button type="button" disabled={!ready||disabled} onClick={()=>void readText()}>Read English text on this device</button>}
        <p role="status" className="work-muted">{status}</p>
        <label htmlFor={id+'-text'}>Page transcription</label>
        <textarea id={id+'-text'} rows={9} disabled={reading||disabled} value={draft} onChange={e=>setDraft(e.target.value)}/>
        {draft.length>MAX_REVIEW_CHARS&&<p>Use up to {MAX_REVIEW_CHARS.toLocaleString()} characters per page.</p>}
        <button type="button" className="work-primary" disabled={reading||disabled||needsTranscription(draft)||draft.length>MAX_REVIEW_CHARS||draft.trim()===saved} onClick={()=>{
          const text=draft.trim();if(onApply(number,text)){setDraft(text);setStatus('Reviewed text added to the evidence.');}else setStatus('The document is too large to add this text.');
        }}>Use reviewed text</button>
        {page.reviewed&&<button type="button" disabled={reading||disabled} onClick={()=>{onApply(number,'');setDraft('');setStatus('Reviewed text removed.')}}>Remove reviewed text</button>}
      </div>
    </div>
  </section>;
}
