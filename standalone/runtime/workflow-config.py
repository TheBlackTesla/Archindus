"""Convert a trusted ComfyUI API export to Archindus workflow configuration.
Example: python workflow-config.py workflow_api.json --prompt-node 6 --kind image --model sdxl --name SDXL --width 1024
Requires the exported graph and all its nodes/checkpoints to already work in ComfyUI.
"""
import argparse
import json
from pathlib import Path
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('export', type=Path)
parser.add_argument('--prompt-node', required=True)
parser.add_argument('--prompt-input', default='text')
parser.add_argument('--seed-node')
parser.add_argument('--kind', choices=['image', 'video'], required=True)
parser.add_argument('--model', required=True)
parser.add_argument('--name', required=True)
parser.add_argument('--width', type=int, default=1024)
parser.add_argument('--id', default='local-workflow')
parser.add_argument('--output', type=Path, default=Path('archindus-workflows.json'))
if __name__ == '__main__':
    args = parser.parse_args()
    graph = json.loads(args.export.read_text())
    graph[args.prompt_node]['inputs'][args.prompt_input] = '__ARCHINDUS_PROMPT__'
    if args.seed_node:
        graph[args.seed_node]['inputs']['seed'] = '__ARCHINDUS_SEED__'
    args.output.write_text(json.dumps([{'id': args.id, 'name': args.name, 'kind': args.kind, 'model': args.model, 'width': args.width, 'workflow': graph}], indent=2))
    print('Workflow configuration written to', args.output)
