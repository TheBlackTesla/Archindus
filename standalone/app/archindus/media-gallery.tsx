"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";

export type MediaArtifact = { id: string; url: string; kind: "image" | "video"; name: string; prompt: string };

/** Native media and download links; generated blobs remain owned by the session. */
export function MediaGallery({ items, initialIndex = 0, onClose }: { items: MediaArtifact[]; initialIndex?: number; onClose?: () => void }) {
  const [selected, setSelected] = useState(initialIndex);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const index = Math.max(0, Math.min(selected, items.length - 1));
  const item = items[index];
  if (!item) return null;
  const move = (direction: number) => { videoRef.current?.pause(); setSelected((index + direction + items.length) % items.length); };
  return <section className="oracle-gallery" role="region" aria-roledescription="carousel" aria-label="Generated media" tabIndex={0}
    onKeyDown={event => {
      if (event.target instanceof HTMLVideoElement) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); }
    }}>
    <div className="oracle-gallery-heading"><span>Ounumi <span className="oracle-divider">/</span> Creation {index + 1} of {items.length}</span>{onClose ? <button type="button" className="oracle-icon" onClick={onClose} aria-label="Close media viewer"><X size={18} /></button> : null}</div>
    <div className="oracle-media-stage" onTouchStart={event => { touch.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }} onTouchEnd={event => {
      if (touch.current && event.changedTouches.length) {
        const dx = event.changedTouches[0].clientX - touch.current.x, dy = event.changedTouches[0].clientY - touch.current.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) move(dx > 0 ? -1 : 1);
      }
      touch.current = null;
    }}>
      {item.kind === "video" ? <video key={item.id} ref={videoRef} src={item.url} controls playsInline preload="metadata" aria-label={item.prompt} /> :
        /* eslint-disable-next-line @next/next/no-img-element */
        <img key={item.id} src={item.url} alt={item.prompt} />}
      {items.length > 1 ? <><button type="button" className="oracle-gallery-arrow oracle-gallery-prev" aria-label="Previous creation" onClick={() => move(-1)}><ChevronLeft size={21} /></button><button type="button" className="oracle-gallery-arrow oracle-gallery-next" aria-label="Next creation" onClick={() => move(1)}><ChevronRight size={21} /></button></> : null}
    </div>
    <div className="oracle-gallery-footer"><p aria-live="polite">{item.name}</p><div className="oracle-gallery-dots">{items.length > 1 ? items.map((entry, i) => <button key={entry.id} type="button" aria-label={`Show creation ${i + 1}`} aria-current={i === index ? "true" : undefined} onClick={() => { videoRef.current?.pause(); setSelected(i); }}><span /></button>) : null}</div><a className="oracle-download" href={item.url} download={item.name}><Download size={16} />Save {item.kind === "video" ? "video" : "image"}</a></div>
  </section>;
}
