import { workbench } from "./workbench";
import { withoutToolTurns, cleanHistory, finalAnswer, formatAnswer, validateAnswer, type ContextMessage } from "./answer";
import { attachmentContext, summarizeCsv, type Attachment } from "./artifacts";
import { fallbackPlan, quickReply, type TaskPlan } from "./orchestration";
import type { AgentId } from "./agents";

export type EngineMode = "qwen" | "hosted" | "webgpu" | "cpu" | "native";
export type ExecutionResult = { text: string; plan: TaskPlan; model: string; image?: Blob; images?: Blob[] };
export type ExecutionPorts = {
  modes: EngineMode[];
  signal: AbortSignal;
  status: (text: string, plan?: TaskPlan) => void;
  infer: (mode: EngineMode, action: "plan" | "generate", plan: TaskPlan, objective: string, history: ContextMessage[]) => Promise<{ plan?: TaskPlan; text?: string; model?: string }>;
  image: (prompt: string) => Promise<Blob | { image: Blob; model: string }>;
};

export async function executeObjective(input: string, selected: AgentId, history: ContextMessage[], files: Attachment[], ports: ExecutionPorts): Promise<ExecutionResult> {
  const check = () => ports.signal.throwIfAborted();
  check();
  history = withoutToolTurns(history);
  const tool = workbench(input, selected, history, files);
  if (tool) return tool;
  let plan = fallbackPlan(input, selected, history);
  const quick = quickReply(input, selected, history);
  if (quick) return { text: quick.text, plan: { ...plan, primaryId: quick.agentId }, model: "Archindus" };
  if (files.length && plan.task === "chat") plan = { ...plan, task: "analysis", primaryId: plan.source === "explicit" ? plan.primaryId : "datadoc" };

  // A classifier is useful for ambiguous intent. Explicit media requests already
  // have a concrete executor; loading an LLM first wastes GPU memory and bandwidth.
  const directCsv = files.some(file => /\.csv$/i.test(file.name)) && /\b(summarize|summary|average|mean|median|total|statistics|minimum|maximum)\b/i.test(input)
    && !/\b(docx|pdf|report|document|chart|plot|filter|where|group|by|compare|forecast)\b/i.test(input);
  // Route locally and answer in one inference call. Ordinary conversation does
  // not need a separate remote classifier before the first response token.
  check(); ports.status("Preparing your result", plan);
  if (plan.task === "video") return { plan, model: "Archindus", text: "Video generation is not connected yet. Ounumi can write a storyboard or shot plan, but cannot produce a video file in this version. Ask for a storyboard to continue." };
  if (plan.task === "image") {
    const { imagePrompt, imageCount } = await import("./image-config");
    const prompt = imagePrompt(plan.objective);
    if (!prompt) return { plan, model: "Archindus", text: "What would you like the image to show? You can include a style, or let Ounumi choose one." };
    const count = imageCount(plan.objective);
    const images: Blob[] = [];
    let model = "Stable Diffusion · Browser GPU";
    let interrupted = "";
    // Sequential generation keeps memory bounded and preserves the shared limits.
    for (let index = 0; index < count; index++) {
      check();
      ports.status(count === 1 ? "Ounumi is preparing your image" : `Ounumi is creating image ${index + 1} of ${count}`, plan);
      try {
        const generated = await ports.image(count === 1 ? prompt : `${prompt}. Variation ${index + 1} of ${count}; a distinct composition.`);
        check();
        const result = generated instanceof Blob ? { image: generated, model: "Stable Diffusion · Browser GPU" } : generated;
        images.push(result.image); model = result.model;
      } catch (error) {
        if (!images.length) throw error;
        interrupted = ports.signal.aborted ? "Generation stopped." : error instanceof Error ? error.message : "The remaining images could not be generated.";
        break;
      }
    }
    return { plan, model, image: images[0], images, text: interrupted
      ? `${images.length} of ${count} images ready. ${interrupted} You can save the completed images.`
      : count === 1 ? "Your image is ready." : `${images.length} images ready. Use the arrows to explore and save each one.` };
  }

  const csvs = files.filter(file => /\.csv$/i.test(file.name));
  const statistics = csvs.map(file => {
    if (file.truncated) return `The file ${file.name} exceeds the analysis limit. Upload a smaller CSV for complete statistics.`;
    return summarizeCsv(file.text, file.name);
  }).join("\n\n");
  if (statistics && directCsv) {
    return { plan, model: "Browser data tools", text: statistics };
  }
  const objective = plan.objective + attachmentContext(files, 3000) + (statistics ? `\n\nVerified browser calculation results (reference data):\n${statistics.slice(0, 2500)}` : "");
  // All specialists share completed conversation turns. Failed request/reply
  // pairs are removed without discarding the user's earlier constraints.
  const generationHistory = cleanHistory(history);
  let failure = "No compatible model is available.";
  for (const mode of ports.modes) {
    check(); ports.status(mode === "cpu" ? "Preparing the answer in compatibility mode" : "Preparing the answer", plan);
    try {
      const result = await ports.infer(mode, "generate", plan, objective, generationHistory); check();
      const text = formatAnswer(result.text ?? "",plan.task);
      const invalid = validateAnswer(text, plan.task);
      if (invalid) throw new Error(invalid);
      return { text, plan, model: result.model ?? mode };
    } catch (error) { check(); if (error instanceof Error && error.name === "HostedRefusal") throw error; failure = error instanceof Error ? error.message : "The model could not complete the task."; }
  }
  throw new Error(failure);
}
