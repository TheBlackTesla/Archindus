import { withoutAgentSelection } from "./agents";
// MLC's published SD 1.5 checkpoint, pinned independently of its moving main branch.
export const IMAGE_MODEL = "Stable Diffusion 1.5";
/** Bound a single request. Each result still reserves its own provider budget. */
export function imageCount(objective: string) {
  const match = objective.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:different\s+)?(?:images?|pictures?|photos?|illustrations?|portraits?|variations?|versions?|generations?|options?)\b/i);
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  return match ? Math.max(1, Math.min(4, words[match[1].toLowerCase()] ?? Number(match[1]))) : 1;
}
export function imagePrompt(objective: string): string | null {
  if (/\b(?:yourself|of you|you look like|self.portrait)\b/i.test(objective)) return "A portrait of Ounumi, an imagined AI creative companion, elegant futuristic humanoid, luminous silver and violet details, warm expressive eyes, architectural studio, cinematic digital art, detailed face, soft lighting";
  const cleaned = withoutAgentSelection(objective)
    .replace(/^(?:can|could|would)\s+you\s+/i, "").replace(/^(?:i\s+(?:want|need)(?:\s+you\s+to)?\s+)/i, "")
    .replace(/^(?:please\s+)?(?:create|make|generate|draw|paint|render|produce|sketch|illustrate)\s+(?:me\s+)?(?:(?:an?|\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?(?:different\s+)?(?:images?|pictures?|photos?|illustrations?|portraits?|artwork|logos?)?\s*(?:of\s+)?/i, "")
    .replace(/\s*Follow-up:\s*$/i, "")
    .replace(/(?:please|for me)[.!?\s]*$/i, "").trim().replace(/^[?.!\s]+|[?.!\s]+$/g, "");
  if (!cleaned || /^(?:an?\s+)?(?:image|picture|photo|portrait|artwork|logo)$/i.test(cleaned)) return null;
  return cleaned.slice(0, 600);
}
