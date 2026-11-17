"""Synthetic loopback transfers; no Ollama, GitHub or patient data."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from pathlib import Path
import subprocess, tempfile

payload = bytes(range(256)) * 8192

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        if self.path == '/error':
            self.send_error(503)
            return
        self.send_response(200)
        if self.path != '/unknown':
            self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload[:1000] if self.path == '/truncated' else payload)
        self.close_connection = True

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
helper = Path(__file__).resolve().parents[1] / 'installer/runtime/Download.Helpers.ps1'
try:
    with tempfile.TemporaryDirectory() as folder:
        for route in ('known', 'unknown', 'truncated', 'error'):
            target = Path(folder) / (route + '.bin')
            script = f"""
$ErrorActionPreference='Stop'
. '{helper}'
$p=Get-DownloadProgress 1500000 3000000
if($p.Percent -ne 50 -or $p.Status -notmatch 'MB / .*MB'){{throw 'Formato MB o percentuale errati'}}
if((Get-DownloadProgress 1500000 -1).Percent -ne -1){{throw 'Totale sconosciuto errato'}}
Receive-FileWithProgress -Uri 'http://127.0.0.1:{server.server_port}/{route}' -OutFile '{target}'
"""
            result = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], capture_output=True)
            if route in ('known', 'unknown'):
                assert result.returncode == 0, result.stderr
                assert target.read_bytes() == payload
                assert b'MB' in result.stdout
            else:
                assert result.returncode != 0, route
                assert not target.exists(), 'Partial file was not removed'
    print('6 download checks passed: MB, percentage, known/unknown size, truncated transfer, HTTP error.')
finally:
    server.shutdown()
    server.server_close()
