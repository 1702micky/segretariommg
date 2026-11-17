"""No installer execution: synthetic pull endpoint, fake Chrome processes, temp files."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from pathlib import Path
import json, subprocess, tempfile

root=Path(__file__).resolve().parents[1]
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert body=={'model':'synthetic:test','stream':True}
        self.send_response(200);self.end_headers()
        rows=[{'status':'pulling','total':3000000,'completed':1500000}]
        if self.path=='/success': rows+=[{'status':'success'}]
        if self.path=='/error': rows+=[{'error':'synthetic error'}]
        for row in rows:self.wfile.write((json.dumps(row)+'\n').encode())
        self.close_connection=True

server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
Thread(target=server.serve_forever,daemon=True).start()
try:
    with tempfile.TemporaryDirectory() as folder:
        for route in ('success','error','missing'):
            progress=Path(folder)/'progress.json'
            script=f"""
$ErrorActionPreference='Stop'
. '{root / 'installer/Setup.Helpers.ps1'}'
. '{root / 'installer/runtime/Download.Helpers.ps1'}'
$script:SetupProgressFile='{progress}'
Publish-SetupProgress 'Test' '50 MB / 100 MB' 50
$p=Get-Content $script:SetupProgressFile -Raw|ConvertFrom-Json
if($p.percent -ne 50 -or $p.stage -ne 'Test'){{throw 'Progress state incorrect'}}
Enable-HiddenOllamaInstall -Directory '{folder}/ollama'
if(-not (Test-Path '{folder}/ollama/upgraded')){{throw 'Missing first-launch marker'}}
# All OS process calls are replaced: no real browser is touched.
function Get-CimInstance {{param($ClassName,$Filter) @([pscustomobject]@{{ProcessId=1}},[pscustomobject]@{{ProcessId=2}})}}
function Invoke-CimMethod {{param($InputObject,$MethodName) @{{ReturnValue=0;Sid=$(if($InputObject.ProcessId -eq 1){{'mine'}}else{{'another-user'}})}}}}
function Get-Process {{param($Id) [pscustomobject]@{{Id=$Id;ProcessName='chrome'}}}}
$script:stopped=@()
function Stop-Process {{param($InputObject,[switch]$Force,$ErrorAction) $script:stopped+=$InputObject.Id}}
Close-UserChrome -UserSid 'mine'
if($script:stopped.Count -ne 1 -or $script:stopped[0] -ne 1){{throw 'Wrong Chrome owner stopped'}}
Receive-OllamaModel -Model 'synthetic:test' -Endpoint 'http://127.0.0.1:{server.server_port}/{route}'
"""
            p=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-Command',script],capture_output=True)
            assert (p.returncode==0)==(route=='success'),p.stderr
        setup=(root/'installer/Setup.ps1').read_text(encoding='utf-8-sig')
        assert setup.index("if ($preflight -ne 'OK')") < setup.index('Close-UserChrome -UserSid')
        assert setup.index('Enable-HiddenOllamaInstall') < setup.index('Start-Process $download')
        assert 'think=$false' in setup
        assert "Start-Process $exe -ArgumentList 'serve' -WindowStyle Hidden" in setup
    print('Setup UI checks passed: progress state, hidden marker, Chrome owner/consent, streamed pull success/error/incomplete, no-thinking preserved.')
finally:
    server.shutdown();server.server_close()
