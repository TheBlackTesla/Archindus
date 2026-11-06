"use client";
import { requestId } from "./request-id";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ChangeEvent } from "react";
import { AGENTS, canonicalAgentId, getAgent, type AgentId } from "./agents";
import { finalAnswer, transportHistory } from "./answer";
import { fallbackPlan, type TaskKind } from "./orchestration";
import { BrowserRuntime, type ModelPreference, type RuntimeReport } from "./browser-runtime";
import { executeObjective } from "./execution";
import {chatModes,duration,engineLabel,type RunRecord} from "./run-record";
import {deviceModel,discoverDeviceModels,LAST_MODEL_KEY,setupTarget,usableModels,withInstallLock,type DeviceModel} from "./device-models";
import {nativeAnswer,nativeReady} from "./native-model";
import {readEvents} from "./stream";
import { type Attachment } from "./artifacts";
import { RichResponse } from "./rich-response";
import { ArtifactCards } from "./artifact-cards";
import { preferredGpuAdapter, imageGpuIssue } from "./gpu";
import { HostedRuntime, imageWithFallback } from "./hosted-runtime";
import { ArrowUp, Check, ChevronLeft, ChevronRight, Copy, History, Paperclip, Plus, RotateCcw, Settings2, Square, Terminal, Network, Braces, Volume2, VolumeX, Waves, X } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { NeuralNetwork } from "./neural-network";
import { MediaGallery, type MediaArtifact } from "./media-gallery";
import { useOracleVoice } from "./use-oracle-voice";
import "./oracle.css";
import {AccountButton,AccountSettings,accountRequest,useAccount,type Thread} from './account-settings';

const STORAGE_KEY = "archindus-native-conversation-v1";
type ConversationMessage = {
  id: string; role: "user" | "assistant"; content: string; agentId?: AgentId;
  status: "complete" | "generating" | "stopped" | "error"; sourceText?: string;
  run?: RunRecord; routeReason?: string; model?: string; imageUrl?: string; hadImage?: boolean; objective?: string; task?: TaskKind;
  attachments?: Array<{ id: string; name: string }>; selectedAgentId?: AgentId; media?: MediaArtifact[];
};
const INITIAL_MESSAGE: ConversationMessage = { id: "welcome", role: "assistant", agentId: "architect", status: "complete", content: "What would you like to work on?" };

function savedConversation(messages: ConversationMessage[]) {
  const start = messages.findIndex(message => message.role === "user");
  const kept = messages.length > 40 && start >= 0 ? [...messages.slice(start, start + 2), ...messages.slice(-38)] : messages;
  return kept.map(m => ({
    ...m, imageUrl: undefined, media: undefined,
    status: m.status === "generating" ? "stopped" : m.status,
    content: m.status === "generating" ? "This request was interrupted. Select Retry to continue." : m.role === "assistant" ? finalAnswer(m.content) : m.content,
  }));
}

export default function ArchindusClient() {
  const accountState=useAccount(), account=accountState.account;
  const [threads,setThreads]=useState<Thread[]>([]),[temporary,setTemporary]=useState(false);
  const threadId=useRef(requestId()),skipPersistence=useRef(false);
  const storageKey=account?.user?.id?`${STORAGE_KEY}:${account.user.id}`:STORAGE_KEY;
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>("architect");
  const [messages, setMessages] = useState<ConversationMessage[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressText, setProgressText] = useState("Ready when you are");
  const [progress, setProgress] = useState(0);
  const [runtimeError, setRuntimeError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [gpuAvailable, setGpuAvailable] = useState<boolean | null>(null);
  const [imageDeviceIssue, setImageDeviceIssue] = useState<string | null>(null);
  const [qwenOnline, setQwenOnline] = useState(false);
  const [qwenConfigured, setQwenConfigured] = useState(false);
  const [hostedAvailable, setHostedAvailable] = useState<boolean|null>(null);
  const [native, setNative] = useState(false);
  const [models, setModels] = useState<DeviceModel[]>([]);
  const [catalog, setCatalog] = useState<"checking"|"checked"|"unavailable">("checking");
  const [f16,setF16] = useState<boolean|null>(null);
  const [lastId,setLastId] = useState<string>();
  const [repair,setRepair] = useState(false);
  const [mayFetchImage,setMayFetchImage] = useState(false);
  const [imageFiles,setImageFiles] = useState(false);
  const [retainedStorage,setRetainedStorage] = useState(false);
  const [deviceOnly, setDeviceOnly] = useState(false);

  const [preference, setPreference] = useState<ModelPreference>("auto");
  const [preparingBrowser, setPreparingBrowser] = useState(false);
  const [browserReady, setBrowserReady] = useState(false);
  const [copied, setCopied] = useState("");
  const [storageError, setStorageError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const runtime = useRef<BrowserRuntime | null>(null);
  const hostedRuntime = useRef<HostedRuntime | null>(null);
  const imageRuntime = useRef<{ generate: (prompt: string, signal: AbortSignal, allowDownload?: boolean) => Promise<Blob>; cancel: () => void } | null>(null);
  const filesById = useRef(new Map<string, Attachment>());
  const imageUrls = useRef(new Set<string>());
  const latestMessages = useRef(messages);
  const restored=useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const responseRef = useRef<HTMLDivElement>(null);
  const neuralActivity = useRef(0);
  const voice = useOracleVoice(deviceOnly, neuralActivity);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedAgent = getAgent(selectedAgentId);
  const usable = usableModels(models,lastId,gpuAvailable,f16);
  const target = setupTarget(preference,gpuAvailable===true,f16===true,models,lastId);
  const saved = models.some(m=>m.id===target.id);
  const warm = browserReady && runtime.current?.readyMode === target.mode && runtime.current?.modelId === target.id;
  const answers = messages.filter(m => m.role === "assistant" && m.id !== "welcome");
  const activeMessage = answers.find(m => m.id === activeMessageId) ?? answers.at(-1);
  const activeIndex = activeMessage ? answers.findIndex(m => m.id === activeMessage.id) : -1;
  const activePrompt = activeMessage?.sourceText ?? "";
  const allMedia = messages.flatMap(m => m.media ?? (m.imageUrl ? [{ id: m.id, url: m.imageUrl, kind: "image" as const, name: "ounumi-image.png", prompt: m.objective ?? m.sourceText ?? "Generated image" }] : []));
  const oracleState = voice.speaking ? "speaking" : isGenerating ? activeMessage?.content ? "responding" : "working" : activeMessage?.status === "error" ? "error" : "idle";

  useEffect(() => {
    if(accountState.loading)return;
    let alive=true;
    const timer = window.setTimeout(() => {void (async()=>{
      try {
        const localOnly=localStorage.getItem("archindus-device-only") === "true";
        setDeviceOnly(localOnly);
        setLastId(localStorage.getItem(LAST_MODEL_KEY) ?? undefined);
        const savedPreference = localStorage.getItem("archindus-model-preference");
        if (["auto", "small", "balanced", "quality", "cpu"].includes(savedPreference ?? "")) setPreference(savedPreference as ModelPreference);
        let saved:string|null=null;
        if(account?.authenticated&&!localOnly&&account.settings.historyEnabled){
          const data=await accountRequest('/conversations');if(!alive)return;setThreads(data.conversations);
          if(data.conversations[0]){const thread=await accountRequest('/conversations/'+data.conversations[0].id);if(!alive)return;threadId.current=thread.id;saved=JSON.stringify(thread.messages);}
        }else if(!account?.authenticated||localOnly)saved=localStorage.getItem(storageKey);
        if (saved) {
          const value: unknown = JSON.parse(saved);
          if (Array.isArray(value)) {
            const valid = value.filter((m): m is ConversationMessage => m && typeof m.id === "string" && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
              .map(m => ({ ...m, agentId: m.agentId ? canonicalAgentId(m.agentId) : undefined, selectedAgentId: m.selectedAgentId ? canonicalAgentId(m.selectedAgentId) : undefined, imageUrl: undefined, media: undefined, content: m.role === "assistant" ? finalAnswer(m.content) : m.content, status: m.status === "generating" ? "stopped" as const : m.status ?? "complete" as const }));
            if (valid.length) { latestMessages.current = valid.slice(-40); setMessages(latestMessages.current); }
          }
        }
      } catch { setStorageError("Conversation history could not be restored on this browser."); }
      if(alive){restored.current=true; setHydrated(true);}
    })();
    }, 0);
    return () => {alive=false;window.clearTimeout(timer)};
  }, [accountState.loading,account?.user?.id]);

  useEffect(() => {
    let active = true;
    void nativeReady().then(ok=>{if(active)setNative(ok)});
    void (async()=>{
      try {
        if(!window.caches) throw new Error("Cache Storage unavailable");
        const [found,image,persisted]=await Promise.all([discoverDeviceModels(window.caches),caches.match("https://huggingface.co/mlc-ai/web-sd/resolve/c33c5ec1cfc95401dd2930972998013e978e0821/web-sd-shards-v1-5/ndarray-cache.json"),navigator.storage?.persisted?.().catch(()=>false)]);
        if(active){setModels(found);setImageFiles(!!image);setRetainedStorage(!!persisted);setCatalog("checked");}
      } catch {if(active)setCatalog("unavailable");}
    })();
    void preferredGpuAdapter().then(adapter => {
      if (active) {
        setGpuAvailable(Boolean(adapter)); setF16(adapter?.features.has("shader-f16") ?? false);
        setImageDeviceIssue(adapter ? imageGpuIssue(adapter.limits) : "Images are unavailable on this device because no working WebGPU adapter was found. Ounumi can still help with writing and creative direction.");
      }
    }).catch(() => {
      if (active) { setGpuAvailable(false); setImageDeviceIssue("This browser could not access its GPU. Ounumi can still help with writing and creative direction."); }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    latestMessages.current = messages;
    if (!hydrated||temporary||isGenerating||skipPersistence.current) return;
    const timer = window.setTimeout(() => {
      try {
        if(account?.authenticated&&!deviceOnly){if(account.settings.historyEnabled)void saveThread(messages).catch(()=>setStorageError('Your conversation could not be synced. Retry from History.'));}
        else if(!account?.authenticated||account.settings.historyEnabled)localStorage.setItem(storageKey, JSON.stringify(savedConversation(messages)));
      }
      catch { setStorageError("Browser storage is full or unavailable. Download your results before leaving."); }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [messages, hydrated,temporary,isGenerating,account?.settings.historyEnabled,account?.user?.id,deviceOnly]);

  useEffect(() => { if (responseRef.current) responseRef.current.scrollTop = 0; }, [activeMessage?.id]);
  useEffect(() => {
    const area = inputRef.current;
    if (area) { area.style.height = "auto"; area.style.height = `${Math.min(area.scrollHeight, 132)}px`; }
  }, [input]);

  useEffect(() => {
    let active = true;
    const check = async () => {
      if(document.hidden)return;
      try {
        const response = await fetch("/api/archindus/status", { cache: "no-store", signal: AbortSignal.timeout(5000) });
        const status = await response.json();
        if (active) { setQwenOnline(Boolean(status.online)); setQwenConfigured(Boolean(status.configured)); setHostedAvailable(Boolean(status.hosted?.available)); }
      } catch { if (active) { setQwenOnline(false); setHostedAvailable(null); } }
    };
    void check(); const interval = window.setInterval(check, 45000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    const persist = () => { if(!restored.current||temporary||skipPersistence.current||account?.authenticated&&!deviceOnly||account?.authenticated&&!account.settings.historyEnabled)return; try { localStorage.setItem(storageKey, JSON.stringify(savedConversation(latestMessages.current))); } catch { /* Storage can be disabled. */ } };
    const urls = imageUrls.current;
    const suspend = () => { persist(); controller.current?.abort(); };
    window.addEventListener("pagehide", suspend);
    return () => { window.removeEventListener("pagehide", suspend); controller.current?.abort(); runtime.current?.cancel(); imageRuntime.current?.cancel(); for (const url of urls) URL.revokeObjectURL(url); };
  }, [temporary,account?.user?.id,account?.settings.historyEnabled,deviceOnly]);

  async function saveThread(value:ConversationMessage[]){
    if(!account?.authenticated||!account.settings.historyEnabled||temporary||deviceOnly||skipPersistence.current||!value.some(m=>m.role==='user'))return;
    const id=threadId.current;
    const clean=savedConversation(value).map(m=>({id:m.id,role:m.role,content:m.content,status:m.status,sourceText:m.sourceText,agentId:m.agentId,selectedAgentId:m.selectedAgentId,model:m.model,task:m.task,objective:m.objective}));
    await accountRequest('/conversations/'+id,'PUT',{messages:clean});
    const list=await accountRequest('/conversations');setThreads(list.conversations);setStorageError('');
  }
  const openThread=async(id:string)=>{
    try{await saveThread(latestMessages.current);const data=await accountRequest('/conversations/'+id);stop();threadId.current=id;latestMessages.current=data.messages;setMessages(data.messages);setActiveMessageId(null);setFiles([]);filesById.current.clear();setTemporary(false);setHistoryOpen(false);setGalleryOpen(false);}
    catch(e){setStorageError(e instanceof Error?e.message:'Conversation unavailable.')}
  };

  const report = (value: RuntimeReport) => {
    if (value.text && value.type === "progress") setProgressText(value.text);
    if (value.progress !== undefined) setProgress(Math.min(100, Math.max(0, value.progress)));
    if (["ready","complete"].includes(value.type)){
      setBrowserReady(true); const m=deviceModel(value.modelId);
      if(m){setLastId(m.id);try{localStorage.setItem(LAST_MODEL_KEY,m.id)}catch{/* Discover actual cache keys on return. */}}
    }
    if (value.type === "error") setBrowserReady(false);
  };
  const patch = (id: string, value: Partial<ConversationMessage>) => setMessages(current => current.map(m => m.id === id ? { ...m, ...value } : m));

  const executePrompt = async (text: string, replaceId?: string) => {
    const objective = text.trim();
    if (!objective || controller.current || uploading) return;
    skipPersistence.current=false;
    voice.stop(); setGalleryOpen(false);
    const existing = latestMessages.current;
    const replaceIndex = replaceId ? existing.findIndex(m => m.id === replaceId) : -1;
    const original = replaceIndex >= 0 ? existing[replaceIndex] : undefined;
    const history = replaceIndex >= 1 ? existing.slice(0, replaceIndex - 1) : existing;
    const priorUser = [...(replaceIndex >= 1 ? existing.slice(0, replaceIndex) : existing)].reverse().find(m => m.role === "user");
    const previousUser=priorUser && !/^\/(?:route|json)(?:\s|$)/i.test(priorUser.content) ? priorUser : undefined;
    const referencesFiles = /\b(it|this|that|same|file|files|document|csv|dataset|data|report|attached|those|these)\b/i.test(objective);
    const referencedFiles = replaceId || referencesFiles ? previousUser?.attachments ?? [] : [];
    const missingFiles = !files.length && referencedFiles.filter(file => !filesById.current.has(file.id));
    if (missingFiles && missingFiles.length) {
      setFileError(`Please attach ${missingFiles.map(file => file.name).join(", ")} again. Uploaded files are only available in the tab where they were added.`);
      return;
    }
    const attached = files.length ? files : referencedFiles.flatMap(file => filesById.current.get(file.id) ?? []);
    const selected = original?.selectedAgentId ?? selectedAgentId;
    const id = replaceId ?? requestId();
    const abort = new AbortController(); controller.current = abort;
    const started=performance.now(), attempts:RunRecord["attempts"]=[];
    let firstTextMs:number|undefined, usedImagePermission=false;
    const record=(engine:string):RunRecord=>({engine,firstTextMs,elapsedMs:performance.now()-started,attempts:[...attempts]});
    const beginAttempt=(engine:string)=>{attempts.push({engine,state:"unavailable"});firstTextMs=undefined;};
    const pending: ConversationMessage = { id, role: "assistant", agentId: selected, content: "", status: "generating", sourceText: objective, selectedAgentId: selected };
    // Retire replaced media only after the next render has stopped displaying it.
    if (original?.imageUrl || original?.media?.length) {
      const obsolete = new Set([...(original.imageUrl ? [original.imageUrl] : []), ...(original.media ?? []).map(m => m.url)]);
      window.setTimeout(() => { for (const url of obsolete) { URL.revokeObjectURL(url); imageUrls.current.delete(url); } }, 1000);
    }
    setActiveMessageId(id);
    if (replaceId) setMessages(current => current.map((m, index) => m.id === id ? pending : index === replaceIndex - 1 && m.role === "user" ? { ...m, attachments: attached.map(f => ({ id: f.id, name: f.name })) } : m));
    else setMessages(current => [...current, { id: requestId(), role: "user", content: objective, status: "complete", attachments: attached.map(f => ({ id: f.id, name: f.name })) }, pending]);
    setInput(""); setFiles([]); setFileError(""); setRuntimeError(""); setIsGenerating(true); setProgress(0); setProgressText("Understanding your request");
    try {
      const remember=/^(?:\/remember\s+|(?:please\s+)?remember that\s+)([\s\S]+)/i.exec(objective);
      if(remember){
        let answer='Sign in and enable saved memory in Settings → Personalization to save this for future chats.';
        if(temporary||deviceOnly)answer='This conversation is private to this tab. Switch off Temporary chat and use Automatic processing to save a memory.';
        else if(account?.authenticated&&account.settings.memoryEnabled){await accountRequest('/memories','POST',{content:remember[1].slice(0,800)});await accountState.refresh();answer='Saved to your Archindus memory. You can edit or delete it in Settings → Personalization.';}
        patch(id,{content:answer,status:'complete',model:'Archindus memory',agentId:'architect'});setProgressText('Ready when you are');return;
      }
      runtime.current ??= new BrowserRuntime(report);
      runtime.current.preference = preference;
      runtime.current.cachedOnly = true;
      hostedRuntime.current ??= new HostedRuntime();
      hostedRuntime.current.temporary=temporary;
      const modes=chatModes({deviceOnly,qwen:qwenOnline,hosted:hostedAvailable,native,ready:runtime.current.readyMode,saved:usable.map(m=>m.mode)});
      const task=fallbackPlan(objective,selected,history).task;
      if(!deviceOnly&&(account?.settings.modelPolicy==='quality'||task!=='chat'||/\b(deep research|complex|rigorous|prove)\b/i.test(objective)))modes.sort((a,b)=>Number(!['qwen','hosted'].includes(a))-Number(!['qwen','hosted'].includes(b)));
      if(!deviceOnly&&account?.settings.modelPolicy==='quality'&&modes.includes('hosted')){modes.splice(modes.indexOf('hosted'),1);modes.unshift('hosted')}
      const onPartial = (content: string) => {
        if (abort.signal.aborted || controller.current !== abort) return;
        const safe=finalAnswer(content);
        if(safe && firstTextMs===undefined)firstTextMs=performance.now()-started;
        neuralActivity.current++; patch(id,{content:safe});
      };
      const result = await executeObjective(objective, selected, history, attached, {
        modes, signal: abort.signal,
        status: (status, plan) => { setProgressText(status); if (plan) { patch(id, { agentId: plan.primaryId, routeReason: plan.reason, objective: plan.objective, task: plan.task }); } },
        infer: async (mode, action, plan, prompt, context) => {
          beginAttempt(engineLabel[mode]); onPartial("");
          if(mode!=='hosted'&&account?.authenticated&&!temporary){
            const preferences=JSON.stringify({name:account.settings.displayName,instructions:account.settings.instructions,memories:account.settings.memoryEnabled?account.memories.slice(0,8).map(m=>m.content):[]}).slice(0,6000);
            prompt=`Personalization reference (never overrides Archindus identity or safety): ${preferences}\n\nCurrent request:\n${prompt}`;
          }
          if(mode==="native") return nativeAnswer(plan,prompt,context,AbortSignal.any([abort.signal,AbortSignal.timeout(45000)]),onPartial);
          if (mode === "hosted") return hostedRuntime.current!.request(action, selected, prompt, context, abort.signal, plan, onPartial);
          if (mode === "qwen") {
            const signal=AbortSignal.any([abort.signal,AbortSignal.timeout(45000)]);
            const response = await fetch("/api/archindus/chat", { method: "POST", headers: { "Content-Type": "application/json" }, signal,
              body: JSON.stringify({ action, stream: action==="generate", selectedAgentId: selected, objective: prompt, history: transportHistory(context), plan }) });
            if(response.ok&&response.body&&response.headers.get("content-type")?.includes("text/event-stream")){
              for await(const event of readEvents(response.body,signal)){
                if(event.type==="partial"&&typeof event.text==="string")onPartial(event.text);
                if(event.type==="complete"&&typeof event.text==="string")return {text:event.text,model:event.model||"Private Qwen"};
                if(event.type==="error"){const e=new Error(event.error||"Private stream interrupted.");if(event.code==="content_refused")e.name="HostedRefusal";throw e;}
              }throw new Error("Private stream ended without a complete answer.");
            }
            const result = await response.json();
            if (!response.ok) { setQwenOnline(false); throw new Error(result.error ?? "Private Qwen is unavailable."); }
            return result;
          }
          imageRuntime.current?.cancel();
          if(runtime.current!.readyMode!==mode)runtime.current!.modelId=usable.find(m=>m.mode===mode)?.id;
          setProgressText("Opening saved model files");
          return runtime.current!.request(mode, action, plan, context, prompt, abort.signal, onPartial);
        },
        image: async prompt => imageWithFallback(!deviceOnly ? async () => {
          beginAttempt("Hosted image API"); setProgressText("Ounumi is generating your image");
          const result = await hostedRuntime.current!.request("image", "ounumi", prompt, [], abort.signal);
          if (!("image" in result) || !result.image) throw new Error("No image was returned.");
          return { image: result.image, model: result.model ?? "Hosted image generation" };
        } : undefined, async () => {
          if(!imageFiles && !usedImagePermission && !(deviceOnly&&mayFetchImage))throw new Error("No saved image model was found. Use hosted images when available, or enable the optional image download in Settings.");
          beginAttempt("Browser GPU · image");
          if (imageDeviceIssue) throw new Error("Hosted image generation is unavailable or has reached its limit, and this device cannot run the local image model. Please try again later or use a browser with a compatible GPU.");
          if(runtime.current?.readyMode==="webgpu")setBrowserReady(false);
          runtime.current?.releaseGpu();
          const { ImageRuntime } = await import("./image-runtime");
          imageRuntime.current ??= new ImageRuntime((status, percent) => { setProgressText(status); setProgress(percent); });
          const allowed=deviceOnly&&mayFetchImage&&!usedImagePermission;
          if(allowed){usedImagePermission=true;setMayFetchImage(false);}
          const image=await imageRuntime.current.generate(prompt,abort.signal,allowed);setImageFiles(true);return image;
        }, abort.signal),
      });
      if (!result.images?.length) abort.signal.throwIfAborted();
      const generated = result.images ?? (result.image ? [result.image] : []);
      const media: MediaArtifact[] = generated.map((blob, index) => {
        const url = URL.createObjectURL(blob); imageUrls.current.add(url);
        return { id: `${id}-${index}`, url, kind: "image", name: `ounumi-${id.slice(0, 8)}-${index + 1}.png`, prompt: result.plan.objective };
      });
      const imageUrl = media[0]?.url;
      const last=attempts.at(-1); if(last)last.state="completed";
      patch(id, { run:record(last?.engine??(result.model==="Archindus"?"Built-in reply":"Browser tool")), content: finalAnswer(result.text), status: "complete", agentId: result.plan.primaryId, routeReason: result.plan.reason, model: result.model, imageUrl, media, hadImage: Boolean(imageUrl), objective: result.plan.objective, task: result.plan.task });
      setProgressText("Ready when you are"); setProgress(100);
      voice.speak(result.text);
    } catch (error) {
      const stopped = abort.signal.aborted;
      const cause=error instanceof Error?error.message:"Please retry.";
      const message=stopped?"Stopped. You can retry this request.":!attempts.length&&cause==="No compatible model is available." ? (deviceOnly?"No local text model is ready. Switch to Automatic for connected AI, or set up an optional model in Settings. Local tools still work.":"No text model is available right now. Retry when a service is online, or use /route and /json on this device.") : cause;
      if(stopped&&attempts.length)attempts[attempts.length-1].state="stopped";
      patch(id,{status:stopped?"stopped":"error",content:message,run:record(stopped?"Stopped":"No result")});
      setProgressText(stopped ? "Stopped" : "Please retry or adjust the request");
      if (!stopped) setRuntimeError(error instanceof Error ? error.message : message);
    } finally { if (controller.current === abort) controller.current = null; setIsGenerating(false); }
  };

  const stop = () => { voice.stop(); controller.current?.abort(); imageRuntime.current?.cancel(); };
  const chooseProcessing = (value: string) => {
    voice.stop();
    const onlyThisDevice = value === "device";
    setDeviceOnly(onlyThisDevice); if(!onlyThisDevice)setMayFetchImage(false);
    try { localStorage.setItem("archindus-device-only", String(onlyThisDevice)); }
    catch { setStorageError("Your processing choice applies to this tab. Browser storage is unavailable, so select it again on your next visit."); }
  };
  const prepareBrowser = async (download:boolean) => {
    if(controller.current||catalog!=="checked"||gpuAvailable===null)return;
    const abort=new AbortController();controller.current=abort;
    setPreparingBrowser(true);setIsGenerating(true);setBrowserReady(false);setRuntimeError("");setProgress(0);setProgressText(download?"Saving missing model files":"Opening saved files");
    runtime.current??=new BrowserRuntime(report);
    const worker=runtime.current;worker.resetFailures();worker.preference=preference;worker.modelId=target.id;worker.cachedOnly=!download;
    try{
      const load=async()=>{
        abort.signal.throwIfAborted();
        if(download){const store=await caches.open("archindus-runtime-v1"),key=new URL("/.archindus-cache-check",location.origin).href;
          await store.put(key,new Response("ok"));await store.delete(key);
          if(navigator.storage?.persist)void navigator.storage.persist().then(setRetainedStorage).catch(()=>{});
        }
        return worker.request(target.mode,"load",fallbackPlan("Chat","architect",[]),[],"",abort.signal);
      };
      const loaded=download?await withInstallLock(load,navigator.locks):await load();abort.signal.throwIfAborted();
      if(!deviceModel(loaded.modelId))throw new Error("The local engine did not report a loaded model.");
      setRepair(false);setProgressText("Ready on this device");chooseProcessing("device");
    }catch(error){setRepair(!abort.signal.aborted);setRuntimeError(abort.signal.aborted?"Setup stopped. Saved files can be reused.":error instanceof Error?error.message:"Could not load this model.");}
    finally{worker.cachedOnly=true;if(controller.current===abort)controller.current=null;setPreparingBrowser(false);setIsGenerating(false);
      try{setModels(await discoverDeviceModels(window.caches));}catch{setCatalog("unavailable");}}
  };
  const chooseModel = (value: ModelPreference) => {
    setPreference(value); setRepair(false);
    try { localStorage.setItem("archindus-model-preference", value); } catch { /* Tab preference still applies. */ }
  };
  const resetConversation = () => {
    stop(); setActiveMessageId(null); setGalleryOpen(false); setHistoryOpen(false); setMessages([INITIAL_MESSAGE]); latestMessages.current = [INITIAL_MESSAGE]; setFiles([]); filesById.current.clear();
    threadId.current=requestId();
    for (const url of imageUrls.current) URL.revokeObjectURL(url); imageUrls.current.clear();
    try { localStorage.removeItem(storageKey); } catch { /* Browser storage can be disabled. */ }
  };
  const clear=()=>{void saveThread(latestMessages.current).catch(()=>setStorageError('The previous conversation could not be synced.'));resetConversation()};
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const selected = [...(event.target.files ?? [])]; event.target.value = "";
    if (selected.length + files.length > 3) { setFileError("Attach up to three files at a time."); return; }
    setUploading(true); setFileError("");
    try {
      const { readAttachment } = await import("./document-tools");
      const loaded: Attachment[] = [];
      for (const file of selected) {
        try { const result = await readAttachment(file); filesById.current.set(result.id, result); loaded.push(result); }
        catch (error) { setFileError(`${file.name}: ${error instanceof Error ? error.message : "This file could not be read."}`); }
      }
      setFiles(current => [...current, ...loaded]);
    } catch (error) { setFileError(error instanceof Error ? error.message : "File reading is unavailable. Please retry."); }
    finally { setUploading(false); }
  };
  const copy = async (message: ConversationMessage) => {
    try { await navigator.clipboard.writeText(finalAnswer(message.content)); setCopied(message.id); }
    catch { setRuntimeError("Copy was unavailable. Use a download button to keep the response."); }
  };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void executePrompt(input); };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
  };

  const showAnswer = (direction: number) => {
    voice.stop(); setGalleryOpen(false);
    setActiveMessageId(answers[Math.max(0, Math.min(answers.length - 1, activeIndex + direction))]?.id ?? null);
  };

  return <main className={`oracle-app ${activeMessage || galleryOpen ? "oracle-has-response" : "oracle-empty"}`} data-state={oracleState}>
    <header className="oracle-header">
      <Link href="https://architectindustries.com" className="oracle-brand" aria-label="Archindus — return to Architect Industries"><span className="oracle-brand-mark" aria-hidden="true">⌁</span>ARCHINDUS</Link>
      <nav className="oracle-toolbar" aria-label="Workspace controls">
        <AccountButton account={account} onClick={()=>setSettingsOpen(true)}/>
        <button type="button" className={'oracle-text-button'+(temporary?' active':'')} disabled={isGenerating||uploading||!hydrated} aria-pressed={temporary} onClick={()=>{clear();setTemporary(!temporary)}}>Temporary chat</button>
        <span className="oracle-header-label">Inference workspace</span>
        {allMedia.length > 0 ? <button type="button" className="oracle-text-button" onClick={() => setGalleryOpen(!galleryOpen)} aria-pressed={galleryOpen}>Creations <span>{allMedia.length}</span></button> : null}
        <button type="button" className="oracle-icon" aria-label="New conversation" title="New conversation" disabled={isGenerating || uploading || !answers.length} onClick={clear}><Plus size={19} /></button>
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}><SheetTrigger asChild><button type="button" className="oracle-icon" aria-label="Conversation history" title="Conversation history" disabled={!hydrated}><History size={18} /></button></SheetTrigger>
          <SheetContent className="oracle-sheet"><SheetHeader><SheetTitle>Conversations</SheetTitle><SheetDescription>{account?.authenticated?'Your saved Archindus conversations.':'Saved on this device. Sign in to sync across devices.'}</SheetDescription></SheetHeader>
            {account?.authenticated?<div className="account-thread-list">{threads.map(thread=><div key={thread.id}><button type="button" disabled={isGenerating} onClick={()=>void openThread(thread.id)}>{thread.title}</button><button type="button" aria-label={'Delete conversation: '+thread.title} disabled={isGenerating} onClick={()=>{void accountRequest('/conversations/'+thread.id,'DELETE',{}).then(async()=>{if(thread.id===threadId.current){skipPersistence.current=true;resetConversation()}const list=await accountRequest('/conversations');setThreads(list.conversations)}).catch(()=>setStorageError('Could not delete this conversation.'))}}>×</button></div>)}</div>:null}
            <div className="oracle-history-list">{answers.length ? answers.map((answer, index) => <button type="button" key={answer.id} className={activeMessage?.id === answer.id ? "active" : ""} onClick={() => { voice.stop(); setActiveMessageId(answer.id); setGalleryOpen(false); setHistoryOpen(false); }}><span>{String(index + 1).padStart(2, "0")} / {answer.model ?? "Archindus"}</span><strong>{answer.sourceText ?? "Earlier response"}</strong><small>{answer.status === "generating" ? "In progress" : answer.content.slice(0, 110)}</small></button>) : <p>Your conversation will appear here.</p>}</div>
            {answers.length ? <button type="button" className="oracle-secondary-button" disabled={isGenerating || uploading} onClick={clear}>Start a new conversation</button> : null}
          </SheetContent>
        </Sheet>
        <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}><SheetTrigger asChild><button type="button" className="oracle-icon" aria-label="Settings" title="Settings" disabled={!hydrated}><Settings2 size={18} /></button></SheetTrigger>
          <SheetContent className="oracle-sheet oracle-settings-sheet"><SheetHeader><SheetTitle>Settings</SheetTitle><SheetDescription>Your Archindus account, personalization, and data.</SheetDescription></SheetHeader>
            <AccountSettings state={accountState} onClear={async()=>{skipPersistence.current=true;stop();await accountRequest('/conversations','DELETE',{});resetConversation();setThreads([])}} onDelete={()=>{skipPersistence.current=true;resetConversation();window.location.assign('/signout-with-chatgpt?return_to=%2F')}}>
            <div className="oracle-settings-body">
              <section><div className="oracle-switch-row"><label htmlFor="oracle-voice-switch">Voice responses</label><Switch id="oracle-voice-switch" checked={voice.enabled} disabled={!voice.supported} onCheckedChange={voice.toggle} /></div><p>{voice.supported ? "Reads answers using your browser’s speech service. Voice availability varies by device. Local voices are preferred." : "Speech playback is unavailable in this browser."}</p></section>
              <section><label htmlFor="oracle-processing">Where to run</label><select id="oracle-processing" value={deviceOnly?"device":"auto"} disabled={isGenerating||!hydrated} onChange={e=>chooseProcessing(e.target.value)}><option value="auto">Automatic · no model downloads</option><option value="device">This device only</option></select><p>Automatic can send your request, conversation context, and relevant file excerpts to a connected service. Choose this device only to keep inference local. Neither mode downloads model weights during chat.</p></section>
              <section><label htmlFor="oracle-model">Optional local model</label><select id="oracle-model" value={preference==="small"?"auto":preference} disabled={isGenerating} onChange={e=>chooseModel(e.target.value as ModelPreference)}><option value="auto">Recommended · reuse saved model</option><option value="cpu">Compatible · Qwen2.5 0.5B CPU</option><option value="balanced" disabled={gpuAvailable===false}>Balanced · Qwen3 1.7B GPU</option><option value="quality" disabled={gpuAvailable===false}>Higher capacity · Qwen3 4B GPU</option></select>
                <div className="oracle-cache-card"><div><strong>{catalog==="checking"?"Checking device storage":warm?"Loaded in memory":saved?"Model files detected":catalog==="unavailable"?"Reusable storage unavailable":"No saved files for this model"}</strong><small>{target.label}</small></div>
                {preparingBrowser?<button type="button" onClick={stop}>Stop setup</button>:<button type="button" disabled={isGenerating||catalog!=="checked"||gpuAvailable===null||warm} onClick={()=>void prepareBrowser(!saved||repair)}>{warm?"Ready":saved&&!repair?"Use saved files":repair?"Repair missing files":"Download missing files"}</button>}</div>
                {preparingBrowser?<p role="status">{progressText}{progress>0?" · "+Math.round(progress)+"%":""}</p>:null}
                {runtimeError?<p className="oracle-notice" role="status">{runtimeError}</p>:null}
                <p><strong>First-use download:</strong> Optional. Setup fetches only missing files for the selected model and switches to on-device processing when ready. Models can be hundreds of MB or more. Reloading or starting a new chat keeps saved files. Clearing site data or browser eviction can remove them.</p>
                {retainedStorage?<p>Persistent browser storage granted.</p>:null}
              </section>
              {deviceOnly?<section><div className="oracle-switch-row"><label htmlFor="oracle-image-download">Allow next image download</label><Switch id="oracle-image-download" checked={mayFetchImage} disabled={isGenerating||!!imageDeviceIssue||catalog!=="checked"} onCheckedChange={setMayFetchImage}/></div><p>Enable once to fetch missing image weights (several GB on first use). Local images need a compatible GPU.</p></section>:null}
              <details className="oracle-system-details"><summary>Runtime inventory</summary><dl><dt>Hosted service</dt><dd>{deviceOnly?"Off for this chat":hostedAvailable===null?"Not yet confirmed":hostedAvailable?"Available within limits":"Unavailable"}</dd><dt>Private server</dt><dd>{qwenOnline?"Online":qwenConfigured?"Offline":"Not connected"}</dd><dt>Built-in browser AI</dt><dd>{native?"Installed and available":"Not available"}</dd><dt>Browser GPU</dt><dd>{gpuAvailable?"Available":gpuAvailable===null?"Checking":"Unavailable"}</dd><dt>Saved text models</dt><dd>{models.length?models.map(m=>m.label).join(", "):catalog==="checked"?"None detected":catalog}</dd><dt>Video generation</dt><dd>Not connected</dd></dl></details>
              <p>File parsing and document exports run on your device. Signed-in text history can sync to your account when enabled. Save generated media before refreshing or starting a new conversation.</p>
            </div>
            </AccountSettings>
          </SheetContent>
        </Sheet>
      </nav>
    </header>

    <div className="oracle-stage">
      <div className="oracle-neural" aria-label={`Archindus is ${oracleState === "idle" ? "ready" : oracleState}`} role="img"><NeuralNetwork state={oracleState} activity={neuralActivity} /></div>
      {!activeMessage && !galleryOpen ? <div className="oracle-presence"><span>ARCHITECT INDUSTRIES / ORACLE</span><h1>What do you want to accomplish?</h1></div> : null}
    </div>

    {activeMessage || galleryOpen ? <div className={`oracle-result ${galleryOpen || activeMessage?.media?.length ? "oracle-result-media" : ""}`} ref={responseRef}>
      {galleryOpen ? <MediaGallery items={allMedia} initialIndex={allMedia.length - 1} onClose={() => setGalleryOpen(false)} /> : activeMessage ? <article key={activeMessage.id} className="oracle-answer">
        <div className="oracle-answer-heading"><span>Archindus</span><div>{answers.length > 1 ? <><button type="button" className="oracle-icon" aria-label="Previous response" disabled={activeIndex <= 0 || isGenerating} onClick={() => showAnswer(-1)}><ChevronLeft size={16} /></button><span className="oracle-answer-count">{activeIndex + 1} / {answers.length}</span><button type="button" className="oracle-icon" aria-label="Next response" disabled={activeIndex >= answers.length - 1 || isGenerating} onClick={() => showAnswer(1)}><ChevronRight size={16} /></button></> : null}</div></div>
        <p className="oracle-prompt-echo" title={activePrompt}>{activePrompt}</p>
        {activeMessage.status === "generating" ? <>
          {activeMessage.content ? <div className="oracle-answer-content oracle-streaming" aria-live="off"><RichResponse content={activeMessage.content} /></div> : null}
          <div className="oracle-working" role="status"><span className="oracle-working-light" /><span>{activeMessage.content ? "Responding…" : progressText}{!activeMessage.content && progress > 0 && progress < 100 ? ` · ${Math.round(progress)}%` : ""}</span></div>
        </> : <>
          <div className={`oracle-answer-content ${activeMessage.status === "error" || activeMessage.status === "stopped" ? "oracle-answer-error" : ""}`} role="status" aria-live="polite"><RichResponse content={finalAnswer(activeMessage.content)} /></div>
          {activeMessage.media?.length ? <MediaGallery items={activeMessage.media} /> : activeMessage.imageUrl ? <MediaGallery items={[{ id: activeMessage.id, url: activeMessage.imageUrl, kind: "image", name: "ounumi-image.png", prompt: activeMessage.objective ?? activePrompt }]} /> : activeMessage.hadImage ? <p className="oracle-notice">This image belonged to an earlier session. Use your saved file or regenerate it.</p> : null}
          <div className="oracle-answer-actions"><button type="button" aria-label="Copy response" onClick={() => void copy(activeMessage)}>{copied === activeMessage.id ? <Check size={15} /> : <Copy size={15} />}{copied === activeMessage.id ? "Copied" : "Copy"}</button>
            {voice.enabled && activeMessage.status === "complete" ? <button type="button" onClick={() => voice.speaking ? voice.stop() : voice.speak(activeMessage.content)}>{voice.speaking ? <Square size={14} /> : <Volume2 size={16} />}{voice.speaking ? "Stop voice" : "Listen"}</button> : null}
            {activeIndex === answers.length - 1 ? <button type="button" disabled={isGenerating || uploading} onClick={() => void executePrompt(activeMessage.sourceText ?? "", activeMessage.id)}><RotateCcw size={15} />{activeMessage.status === "error" || activeMessage.status === "stopped" ? "Retry" : "Regenerate"}</button> : null}
            {activeMessage.status === "complete" && !activeMessage.hadImage ? <details className="oracle-save"><summary>Save response</summary><ArtifactCards text={activeMessage.content} /></details> : null}
          </div>
          {activeMessage.status === "complete" && /```/.test(activeMessage.content) ? <div className="oracle-source-files"><ArtifactCards text={activeMessage.content} compact /></div> : null}
          {activeMessage.run||activeMessage.routeReason?<details className="oracle-receipt"><summary><Terminal size={15} aria-hidden="true"/><strong>Run details</strong><span>{activeMessage.run?activeMessage.run.engine+" · "+duration(activeMessage.run.elapsedMs):"Routing"}</span></summary>
            <dl><dt>Task</dt><dd>{activeMessage.task ?? "Conversation"}</dd>
            {activeMessage.model?<><dt>Model</dt><dd>{activeMessage.model}</dd></>:null}
            {activeMessage.run?<><dt>First streamed text</dt><dd>{activeMessage.run.firstTextMs!==undefined?duration(activeMessage.run.firstTextMs):"No streamed text"}</dd><dt>End to end</dt><dd>{duration(activeMessage.run.elapsedMs)}</dd></>:null}
            {activeMessage.run?.attempts.length?<><dt>Attempts</dt><dd>{activeMessage.run.attempts.map(a=>a.engine+" ("+a.state+")").join(" → ")}</dd></>:null}</dl>
            {activeMessage.routeReason?<p>{activeMessage.routeReason}</p>:null}</details>:null}
        </>}
      </article> : null}
    </div> : null}

    <div className="oracle-bottom">
      {(fileError || storageError || voice.error) ? <p className="oracle-notice" role="status">{fileError || voice.error || storageError}</p> : null}
      {files.length ? <ul className="oracle-attachments">{files.map(file => <li key={file.id}><Paperclip size={13} /><span>{file.name}{file.truncated ? " · excerpt" : ""}</span><button type="button" className="oracle-icon" aria-label={`Remove ${file.name}`} onClick={() => setFiles(current => current.filter(f => f.id !== file.id))}><X size={14} /></button></li>)}</ul> : null}
      {!activeMessage&&!galleryOpen?<div className="oracle-examples" aria-label="Example requests">
        <button type="button" disabled={!hydrated||isGenerating} onClick={()=>void executePrompt("/route Write a Python function that merges two sorted lists.")}><Network size={15}/>Trace a route</button>
        <button type="button" disabled={!hydrated||isGenerating} onClick={()=>{setInput('/json {"engine":"archindus","local":true,"tasks":["code","analysis"]}');inputRef.current?.focus();}}><Braces size={15}/>Inspect JSON</button>
        <button type="button" disabled={!hydrated||isGenerating} onClick={()=>{setInput("Write a Python function to deduplicate a stream of records by ID. Include a small test.");inputRef.current?.focus();}}><Terminal size={15}/>Write code</button>
      </div>:null}
      {preparingBrowser?<p className="oracle-notice" role="status">{progressText}</p>:null}
      <form className="oracle-composer" onSubmit={submit}>
        <button type="button" className="oracle-icon oracle-attach" aria-label="Attach files" title="Attach PDF, DOCX, TXT, Markdown, CSV or JSON (up to 3 files, 5 MB each)" disabled={isGenerating || uploading} onClick={() => fileInputRef.current?.click()}><Paperclip size={20} /></button>
        <input ref={fileInputRef} type="file" aria-label="Upload reference documents" accept=".pdf,.docx,.txt,.md,.csv,.json" multiple hidden onChange={event => void upload(event)} />
        <label htmlFor="archindus-prompt" className="sr-only">Message Archindus</label>
        <textarea ref={inputRef} id="archindus-prompt" disabled={!hydrated} value={input} onChange={event => setInput(event.target.value)} onKeyDown={keyDown} placeholder={uploading ? "Reading your files…" : "Ask a question or describe a task…"} rows={1} maxLength={2400} aria-describedby="oracle-processing-note" />
        <button type="button" className={`oracle-voice ${voice.enabled ? "active" : ""}`} aria-label={`Turn voice ${voice.enabled ? "off" : "on"}`} aria-pressed={voice.enabled} disabled={!voice.supported} title={voice.supported ? "Read responses aloud" : "Voice is unavailable in this browser"} onClick={() => voice.toggle(!voice.enabled)}>{voice.enabled ? <Waves size={18} /> : <VolumeX size={18} />}<span>Voice {voice.enabled ? "on" : "off"}</span></button>
        {isGenerating ? <button type="button" className="oracle-send oracle-stop" aria-label="Stop generation" onClick={stop}><Square size={16} fill="currentColor" /></button> : <button type="submit" className="oracle-send" aria-label="Send message" disabled={!input.trim() || uploading || !hydrated}><ArrowUp size={22} strokeWidth={1.7} /></button>}
      </form>
      <div className="oracle-composer-meta"><button type="button" onClick={() => setSettingsOpen(true)} id="oracle-processing-note">{temporary?'Temporary · no history or memory':deviceOnly ? "On device only" : "Automatic"}<span className="oracle-meta-separator">·</span>{mayFetchImage && deviceOnly ? "Image download enabled" : "Archindus"}</button><span className="oracle-key-hint">Enter to send</span></div>
    </div>
  </main>;
}
