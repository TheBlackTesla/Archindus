import { taskInstructions, type TaskPlan } from "./orchestration";

/** WASM promises can starve worker messages; yield after each forward pass. */
export async function cooperativeStep<T>(forward: () => Promise<T>): Promise<T> {
  const output = await forward();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  return output;
}

/** Small local models need a short conversational contract, not a routing essay. */
export function localPrompt(plan: TaskPlan) {
  const specialty = plan.primaryId === "ounumi" ? "Write the requested creative work directly, matching its length and style."
    : plan.primaryId === "satoshi" ? "Write and explain working code."
    : plan.primaryId === "datadoc" ? "Use the supplied documents and data accurately."
    : plan.primaryId === "socrates" ? "Explain clearly and distinguish facts from uncertainty."
    : plan.primaryId === "wolf" ? "Give practical strategic advice."
    : "Help the user with their question or task.";
  return `You are Archindus, the AI assistant from Architect Industries. Your name is Archindus, not Architect, even if earlier messages used another name. ${specialty} Use earlier messages to understand follow-ups and remember the user's details. Answer the latest request concisely. Do not introduce yourself unless asked.\n${taskInstructions(plan)}`;
}
