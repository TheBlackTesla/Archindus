"""Authenticated, narrowly scoped Archindus gateway for Ollama and ComfyUI.
Python 3.10+; no dependencies. Run on the GPU workstation, behind an HTTPS tunnel.
No models are installed or downloaded by this program.
"""
import hmac
import http.client
import json
import os
import re
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs
from pathlib import Path

TOKEN_FILE = Path(__file__).with_name('.gateway-token')
if not TOKEN_FILE.exists():
    fd = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as file:
        file.write(secrets.token_urlsafe(36))
TOKEN = os.environ.get('ARCHINDUS_GATEWAY_TOKEN') or TOKEN_FILE.read_text().strip()
if len(TOKEN) < 32:
    raise SystemExit('Gateway token must contain at least 32 characters.')
SLOTS = threading.BoundedSemaphore(4)
UPSTREAMS = {
    'ollama': urlsplit(os.environ.get('OLLAMA_UPSTREAM', 'http://127.0.0.1:11434')),
    'comfy': urlsplit(os.environ.get('COMFYUI_UPSTREAM', 'http://127.0.0.1:8188')),
}
for url in UPSTREAMS.values():
    if url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost', '::1') or url.path not in ('', '/'):
        raise SystemExit('Upstreams must be fixed loopback HTTP origins.')


def destination(method, path, body):
    url = urlsplit(path)
    if method == 'GET' and url.path == '/v1/models' and not url.query:
        return 'ollama', '/v1/models'
    if method == 'POST' and url.path == '/v1/chat/completions' and not url.query:
        return 'ollama', '/v1/chat/completions'
    if method == 'POST' and url.path == '/comfy/prompt' and not url.query:
        value = json.loads(body)
        if not isinstance(value.get('prompt'), dict) or len(value['prompt']) > 200:
            raise ValueError('Invalid workflow')
        return 'comfy', '/prompt'
    if method == 'GET' and re.fullmatch(r'/comfy/history/[a-fA-F0-9-]{36}', url.path) and not url.query:
        return 'comfy', url.path.removeprefix('/comfy')
    if method == 'POST' and url.path == '/comfy/queue' and not url.query:
        value = json.loads(body)
        if set(value) != {'delete'} or not isinstance(value['delete'], list) or len(value['delete']) > 1 or not all(isinstance(v, str) and re.fullmatch(r'[a-fA-F0-9-]{36}', v) for v in value['delete']):
            raise ValueError('Only deletion of one queued job is allowed')
        return 'comfy', '/queue'
    if method == 'GET' and url.path == '/comfy/view':
        query = parse_qs(url.query, keep_blank_values=True)
        if set(query) != {'filename', 'subfolder', 'type'} or any(len(v) != 1 for v in query.values()):
            raise ValueError('Invalid output request')
        filename, folder = query['filename'][0], query['subfolder'][0]
        if query['type'] != ['output'] or '..' in filename or '..' in folder or not re.fullmatch(r'[A-Za-z0-9_. -]{1,180}\.(?:png|mp4)', filename, re.I) or not re.fullmatch(r'[-A-Za-z0-9_/]*', folder):
            raise ValueError('Only generated PNG/MP4 outputs are allowed')
        return 'comfy', '/view?' + url.query
    raise ValueError('Route is not exposed')


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.0'

    def log_message(self, fmt, *args):
        # Never log authorization, request bodies, prompts or URL queries.
        pass

    def error(self, status, message):
        payload = json.dumps({'error': message}).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def handle_request(self):
        if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + TOKEN):
            return self.error(401, 'Gateway authentication required')
        if not SLOTS.acquire(blocking=False):
            return self.error(429, 'Gateway concurrency limit reached')
        connection = None
        started = False
        try:
            self.connection.settimeout(120)
            length = int(self.headers.get('Content-Length', '0'))
            if length < 0 or length > 150_000 or self.headers.get('Transfer-Encoding'):
                return self.error(413, 'Request too large or unsupported framing')
            body = self.rfile.read(length)
            service, route = destination(self.command, self.path, body)
            origin = UPSTREAMS[service]
            connection = http.client.HTTPConnection(origin.hostname, origin.port, timeout=120)
            connection.request(self.command, route, body=body if length else None, headers={'Content-Type': 'application/json', 'Accept-Encoding': 'identity'})
            response = connection.getresponse()
            self.send_response(response.status)
            self.send_header('Content-Type', response.getheader('Content-Type', 'application/json'))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            started = True
            total = 0
            while True:
                chunk = response.read1(8192)
                if not chunk:
                    break
                total += len(chunk)
                if total > 20_000_000:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (ValueError, json.JSONDecodeError):
            if not started:
                self.error(400, 'Invalid or unexposed request')
        except (OSError, http.client.HTTPException):
            if not started:
                self.error(502, 'Local runtime unavailable')
        finally:
            if connection:
                connection.close()
            SLOTS.release()

    do_GET = handle_request
    do_POST = handle_request


if __name__ == '__main__':
    print('Archindus gateway listening on 127.0.0.1:8123. Token saved beside gateway.py in .gateway-token.')
    print('Copy that token into deployed Archindus Settings, never into chat. Keep this terminal running.')
    ThreadingHTTPServer(('127.0.0.1', 8123), Handler).serve_forever()
