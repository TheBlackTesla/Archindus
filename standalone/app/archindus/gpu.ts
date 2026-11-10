// A narrow capability view keeps the UI independent of runtime-specific GPU types.
type BrowserGpu = { requestAdapter(options?: { powerPreference: "high-performance" }): Promise<null | { features: ReadonlySet<string>; limits: { maxBufferSize: number; maxStorageBufferBindingSize: number; maxComputeWorkgroupStorageSize: number } }> };
export function browserGpu() { return (navigator as Navigator & { gpu?: BrowserGpu }).gpu; }

export async function preferredGpuAdapter() {
  const gpu = browserGpu();
  if (!gpu) return null;
  try { return await gpu.requestAdapter({ powerPreference: "high-performance" }) ?? await gpu.requestAdapter(); }
  catch { return await gpu.requestAdapter(); }
}

/** The limits required by this specific compiled MLC SD 1.5 model. Not free VRAM. */
export function imageGpuIssue(limits: NonNullable<Awaited<ReturnType<typeof preferredGpuAdapter>>>["limits"]) {
  if (limits.maxBufferSize < 1_073_741_824 || limits.maxStorageBufferBindingSize < 1_073_741_824 || limits.maxComputeWorkgroupStorageSize < 32_768) {
    return "This GPU does not support Ounumi's image model. Try a computer with a more capable GPU. No model files were downloaded.";
  }
  return null;
}
