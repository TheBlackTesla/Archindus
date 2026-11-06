"""Route-policy tests without starting servers or generating credentials."""
import ast
from pathlib import Path
import unittest
import json
import re
from urllib.parse import urlsplit, parse_qs
module = ast.parse(Path(__file__).with_name('gateway.py').read_text())
namespace = {'json': json, 're': re, 'urlsplit': urlsplit, 'parse_qs': parse_qs}
exec(compile(ast.Module(body=[node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == 'destination'], type_ignores=[]), '<gateway policy>', 'exec'), namespace)
route = namespace['destination']
class PolicyTests(unittest.TestCase):
    def test_chat_and_discovery(self):
        self.assertEqual(route('GET', '/v1/models', b''), ('ollama', '/v1/models'))
        self.assertEqual(route('POST', '/v1/chat/completions', b'{}'), ('ollama', '/v1/chat/completions'))
    def test_admin_proxy_and_model_download_routes_are_blocked(self):
        for path in ['/api/pull', '/comfy/interrupt', '/comfy/upload/image', '/comfy/system_stats', 'https://evil.test/v1/models', '/v1/models?target=secret']:
            with self.assertRaises(ValueError):
                route('POST', path, b'{}')
    def test_only_one_explicit_queue_deletion(self):
        remote = '12345678-1234-1234-1234-123456789012'
        self.assertEqual(route('POST', '/comfy/queue', json.dumps({'delete': [remote]}).encode()), ('comfy', '/queue'))
        for data in [{'clear': True}, {'delete': [remote], 'clear': True}, {'delete': ['bad']}, {'delete': [remote, remote]}]:
            with self.assertRaises(ValueError):
                route('POST', '/comfy/queue', json.dumps(data).encode())
    def test_only_safe_output_paths(self):
        self.assertEqual(route('GET', '/comfy/view?filename=test.mp4&subfolder=&type=output', b'')[0], 'comfy')
        for path in ['filename=..%2Fprivate.mp4&subfolder=&type=output', 'filename=secret.png&subfolder=..%2F&type=output', 'filename=test.png&subfolder=&type=input', 'filename=test.png&subfolder=&type=output&other=1']:
            with self.assertRaises(ValueError):
                route('GET', '/comfy/view?' + path, b'')
if __name__ == '__main__':
    unittest.main()
