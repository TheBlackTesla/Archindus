# Connect your RTX 4090 to Archindus

This optional gateway uses Python 3.10+ without dependencies. It does not install models, expose general computer access, or create a paid cloud GPU. Keep Ollama/ComfyUI on loopback; only the authenticated gateway goes through the tunnel.

1. Install [Ollama](https://ollama.com/download) on the workstation. In its terminal, explicitly install a model once:

   ```sh
   ollama pull qwen3.5:4b
   ```

   Start small and verify the tag exists in your Ollama registry. Optional larger models include `qwen3.5:27b`, `gpt-oss:20b`, and `qwen2.5-coder:14b`. Install only those you want and can fit; routing does not pull models. An MoE's active parameter count does not equal its total weight memory requirement. Your 24 GB GPU may need quantization, offload, or smaller models.

2. Run `python gateway.py` from this directory. The script creates a private `.gateway-token` file. Keep the process running. Ollama should be listening at `127.0.0.1:11434`.
3. Install [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and run:

   ```sh
   cloudflared tunnel --url http://127.0.0.1:8123
   ```

   For a persistent address use a named tunnel or Tailscale Funnel; a quick tunnel changes after restart.
4. Open the **deployed** Archindus site, sign in, and choose **Settings → Runtime & voice → Model connections → Ollama**. Paste the generated HTTPS URL followed by `/v1`, and paste the contents of `.gateway-token` into the gateway token field. Save. Never paste this token into chat or GitHub. Archindus discovers installed approved models and checks access when it uses them.
5. Keep workstation, runtimes, gateway and tunnel running. If offline, Automatic mode can fall back to your other configured providers. “This device only” refers to the current browser device and excludes this server-side gateway.

## Open image and video models through ComfyUI

Install [ComfyUI](https://github.com/Comfy-Org/ComfyUI) from its official instructions, keep it on `127.0.0.1:8188`, and first generate a valid result locally. Install the model files and nodes for your chosen official workflow. Useful families include SDXL, FLUX.2 Klein 4B, Wan2.2 TI2V 5B and LTX-2. Availability, VRAM, license and output format vary; no weight files or unverified graphs are bundled here.

Export the working graph in **API format**. Convert it with `workflow-config.py`, selecting the positive prompt text node. Example (node IDs differ by workflow):

```sh
python workflow-config.py workflow_api.json --prompt-node 6 --seed-node 3 --kind image --model sdxl --name SDXL --width 1024
```

Use `--kind video` for an installed workflow that saves MP4. Multiple converted entries can be combined into one JSON array. This version uses the first configured workflow for the requested media type. PNG/MP4 output must be 20 MB or smaller. Set `--width` to the workflow's actual image width (256–1536).

In Model connections choose **ComfyUI images & video**, enter the same tunnel URL followed by `/comfy`, the same gateway token, and the generated JSON configuration. No GPU model is marked connected until a valid workflow is saved. Model execution and output correctness still depend on your installed worker.

Outputs remain on the GPU worker under its retention policy; Archindus download links expire after 24 hours. Cancel removes an owned queued job; an already-running job may finish. The gateway never exposes ComfyUI's global interrupt or file upload/admin endpoints. Treat anyone holding the gateway token as trusted to submit inference/workflows; rotate it by stopping the gateway, deleting `.gateway-token`, restarting and updating both Archindus connections.

No per-token API bill is incurred for local inference, but electricity, hardware and any tunnel/cloud hosting costs still apply. This workstation setup is supplied and protocol-tested; it has not been run on your physical GPU from this environment.
