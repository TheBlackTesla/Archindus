// Report missing scripts/WASM promptly instead of leaving the conversation busy.
const reportBootFailure = () => parent.postMessage({ channel: "archindus-image", type: "boot-error" }, location.origin);
window.addEventListener("error", reportBootFailure, true);
window.addEventListener("unhandledrejection", reportBootFailure);
