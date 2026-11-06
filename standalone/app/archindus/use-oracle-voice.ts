"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {preferredBrowserVoice,matchesPreferredVoice,loadBrowserVoices} from './browser-voices';
import {VoicePlayback} from './voice-playback';
import {VOICE_TEXT_LIMIT} from './voice-config';
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
  const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI,setSelectedVoiceURI]=useState('');
  const [remoteConfigured,setRemoteConfigured]=useState<boolean|null>(null);
  const player=useRef<VoicePlayback|null>(null);
  const [preparing,setPreparing]=useState(false);
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState("");
  const enabledRef = useRef(false);
  const generation = useRef(0);
  // Some engines collect an utterance unless the application retains it.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(()=>{const synth=window.speechSynthesis;if(!synth)return;const update=()=>setVoices(synth.getVoices());update();synth.addEventListener('voiceschanged',update);try{setSelectedVoiceURI(localStorage.getItem('archindus-browser-voice')??'')}catch{}return()=>synth.removeEventListener('voiceschanged',update)},[]);

  useEffect(()=>{const controller=new AbortController();void fetch('/api/archindus/voice',{signal:controller.signal}).then(r=>r.ok?r.json():null).then(data=>{if(!controller.signal.aborted)setRemoteConfigured(data?.configured===true)}).catch(()=>{if(!controller.signal.aborted)setRemoteConfigured(false)});return()=>controller.abort()},[]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const available = "Audio" in window || ("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
      setSupported(available);
      try {
        enabledRef.current = available && localStorage.getItem("archindus-voice") === "true";
        setEnabled(enabledRef.current);
      } catch { /* Voice still works when browser storage is disabled. */ }
    }, 0);
    return () => { window.clearTimeout(timer); generation.current++; window.speechSynthesis?.cancel(); player.current?.clear(); };
  }, []);

  const stop = useCallback(() => {
    generation.current++; player.current?.stop(); window.speechSynthesis?.cancel(); utteranceRef.current = null; setSpeaking(false);setPreparing(false);
  }, []);
  // Switching to local-only processing must also stop any remote voice.
  useEffect(() => { stop();player.current?.clear(); }, [deviceOnly,stop]);

  const toggle = useCallback((value: boolean) => {
    stop(); enabledRef.current = value && supported; setEnabled(enabledRef.current); setError("");
    try { localStorage.setItem("archindus-voice", String(enabledRef.current)); } catch { /* Session preference remains available. */ }
  }, [stop, supported]);

  const speak = useCallback((content: string) => {
    stop();
    if (!enabledRef.current || !supported) return;
    const text = speechText(content);
    if (!text) return;
    if(!deviceOnly&&remoteConfigured){
      const token=generation.current;setError('');setPreparing(true);player.current??=new VoicePlayback();
      const spoken=text.slice(0,VOICE_TEXT_LIMIT);if(text.length>VOICE_TEXT_LIMIT)setError('Voice reads the first 2,400 characters. The full answer is shown as text.');
      void player.current.speak(spoken,()=>{if(token===generation.current){setPreparing(false);setSpeaking(true);if(activity)activity.current++}},()=>{if(token===generation.current){setPreparing(false);setSpeaking(false)}},message=>{if(token===generation.current)setError(message)}).catch(e=>{if(token===generation.current){setPreparing(false);setSpeaking(false);setError(e instanceof Error?e.message:'Voice could not play. Tap Listen to try again.')}});
      return;
    }
    if(!('speechSynthesis' in window)&&!('SpeechSynthesisUtterance' in window)){setError('A local browser voice is unavailable. Connect ElevenLabs to use the main Archindus voice.');return;}
    if(!window.speechSynthesis||!window.SpeechSynthesisUtterance){setError('A browser voice is unavailable.');return;}
    const token = generation.current;
    setError('');setPreparing(true);
    void loadBrowserVoices(window.speechSynthesis).then(available=>{
    if(token!==generation.current||!enabledRef.current)return;
    setVoices(available);setPreparing(false);
    const preferred=preferredBrowserVoice(available,deviceOnly,selectedVoiceURI);
    if(deviceOnly&&!preferred){setError('A local voice is unavailable on this device. Your response is shown as text.');return;}
    if(!preferred){setError('Browser voices are still loading. Tap Listen to try again.');return;}
    const chunks = text.match(/.{1,220}(?:[.!?]\s|\s|$)|.{1,220}/g) ?? [text];
    const next = (index: number) => {
      if (token !== generation.current || !enabledRef.current) return;
      if (index >= chunks.length) { setSpeaking(false); utteranceRef.current = null; return; }
      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      utteranceRef.current = utterance;
      utterance.voice = preferred;utterance.lang=preferred.lang;
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
    }).catch(()=>{if(token===generation.current){setPreparing(false);setError('Browser voices could not load. Tap Listen to try again.')}});
  }, [deviceOnly, remoteConfigured, selectedVoiceURI, stop, supported, activity]);

  const chooseVoice=(uri:string)=>{stop();setSelectedVoiceURI(uri);try{localStorage.setItem('archindus-browser-voice',uri)}catch{}};
  const browserVoice=preferredBrowserVoice(voices,deviceOnly,selectedVoiceURI);
  const voiceOptions=voices.filter(v=>!deviceOnly||v.localService);
  return { browserVoice,voiceOptions,selectedVoiceURI,chooseVoice,preferredVoiceAvailable:matchesPreferredVoice(browserVoice),enabled, supported, speaking, preparing, remoteConfigured, error, toggle, speak, stop };
}
