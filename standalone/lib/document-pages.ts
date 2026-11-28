export type ReviewedPage = { page: number; text: string };
export const MAX_REVIEW_CHARS = 24_000;
export const MAX_PROJECT_TEXT = 600_000;

export function needsTranscription(text: string) {
  return !text.split(/\r?\n/).some(line => {
    const value = line.trim();
    return value && !/^(?:page\s+)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i.test(value);
  });
}

export function documentPages(file: { pages?: string[]; reviewedPages?: ReviewedPage[] }) {
  const reviews = new Map(file.reviewedPages?.map(item => [item.page, item.text.trim()]));
  return (file.pages ?? []).map((native, index) => {
    const eligible = needsTranscription(native);
    const draft = eligible ? reviews.get(index + 1) : undefined;
    const reviewed = !!draft && !needsTranscription(draft);
    return { page: index + 1, native, eligible, reviewed, text: reviewed ? draft! : native };
  });
}
