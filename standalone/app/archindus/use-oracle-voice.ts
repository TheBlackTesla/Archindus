"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { finalAnswer } from "./answer";

export function speechText(content: string) {
  return finalAnswer(content)
    .replace(/```[\s\S]*?```/g, " Code is available in the response. ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^[#>*\-]+\s*/gm, "")
    .replace(/[*`_|]/g, "").replace(/\s+/g, " ").trim();
}

export function useOracleVoice(deviceOnly: boolean, activity?: RefObject<number>) {
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const enabledRef = useRef(false);
  const generation = useRef(0);
  // Some engines collect an utterance unless the application retains it.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const available = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
      setSupported(available);
      try {
        enabledRef.current = available && localStorage.getItem("archindus-voice") === "true";
        setEnabled(enabledRef.current);
      } catch { /* Voice still works when browser storage is disabled. */ }
    }, 0);
    return () => { window.clearTimeout(timer); generation.current++; window.speechSynthesis?.cancel(); };
  }, []);

  const stop = useCallback(() => {
    generation.current++; window.speechSynthesis?.cancel(); utteranceRef.current = null; setSpeaking(false);
  }, []);
  // Switching to local-only processing must also stop any remote voice.
  useEffect(() => { window.speechSynthesis?.cancel(); generation.current++; }, [deviceOnly]);

  const toggle = useCallback((value: boolean) => {
    stop(); enabledRef.current = value && supported; setEnabled(enabledRef.current); setError("");
    try { localStorage.setItem("archindus-voice", String(enabledRef.current)); } catch { /* Session preference remains available. */ }
  }, [stop, supported]);

  const speak = useCallback((content: string) => {
    stop();
    if (!enabledRef.current || !supported) return;
    const text = speechText(content);
    if (!text) return;
    const voices = window.speechSynthesis.getVoices();
    const eligible = deviceOnly ? voices.filter(voice => voice.localService) : voices;
    if (deviceOnly && !eligible.length) { setError("A local voice is unavailable on this device. Your response is shown as text."); return; }
    const preferred = eligible.find(voice => voice.localService && /^en/i.test(voice.lang)) ?? eligible.find(voice => /^en/i.test(voice.lang)) ?? eligible[0];
    const chunks = text.match(/.{1,220}(?:[.!?]\s|\s|$)|.{1,220}/g) ?? [text];
    const token = generation.current;
    setError("");
    const next = (index: number) => {
      if (token !== generation.current || !enabledRef.current) return;
      if (index >= chunks.length) { setSpeaking(false); utteranceRef.current = null; return; }
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utteranceRef.current = utterance;
      if (preferred) utterance.voice = preferred;
      utterance.rate = 1.02;
      utterance.onstart = () => { if (token === generation.current) { setSpeaking(true); if (activity) activity.current++; } };
      utterance.onboundary = () => { if (token === generation.current && activity) activity.current++; };
      utterance.onend = () => next(index + 1);
      utterance.onerror = event => {
        if (token !== generation.current) return;
        setSpeaking(false);
        if (event.error !== "interrupted" && event.error !== "canceled") setError("Voice could not play. You can read the response or try Listen again.");
      };
      window.speechSynthesis.speak(utterance);
    };
    next(0);
  }, [deviceOnly, stop, supported, activity]);

  return { enabled, supported, speaking, error, toggle, speak, stop };
}
