"""Execute updater against synthetic releases and temp roots; no network/installed files."""
import hashlib,json,subprocess,tempfile,zipfile,shutil
from pathlib import Path
root=Path(__file__).resolve().parents[1]
original=(root/'installer/runtime/Update.ps1').read_text(encoding='utf-8-sig')
with tempfile.TemporaryDirectory() as folder:
 base=Path(folder)
 for mode in ['success','current','chrome','network','digest','rollback','check','automatic']:
  work=base/mode;work.mkdir();installed=work/'extension';installed.mkdir();state=work/'state'
  names=['manifest.json','segretario.js','background.js','lab_catalog.json','paddle_sandbox.html','paddle_sandbox.js']
  old={n:(json.dumps({'version':'1.0.0','key':'synthetic-key'}) if n=='manifest.json' else 'OLD '+n).encode() for n in names}
  new={n:(json.dumps({'version':'1.1.0','key':'synthetic-key'}) if n=='manifest.json' else 'NEW '+n).encode() for n in names}
  for n,b in old.items():(installed/n).write_bytes(b)
  package=work/'fixture.zip'
  with zipfile.ZipFile(package,'w') as z:
   for n,b in new.items():z.writestr('extension/'+n,b)
   z.writestr('inventory.json',json.dumps({'version':'1.1.0','files':[{'path':n,'sha256':hashlib.sha256(b).hexdigest()} for n,b in new.items()]}))
  digest=hashlib.sha256(package.read_bytes()).hexdigest() if mode!='digest' else '0'*64
  release={'tag_name':'v1.0.0' if mode=='current' else 'v1.1.0','prerelease':False,'draft':False,'assets':[{'name':'segretario-mmg-update.zip','digest':'sha256:'+digest,'browser_download_url':'https://github.com/1702micky/segretariommg/releases/download/v1.1.0/segretario-mmg-update.zip'}]}
  for name in ['Download.Helpers.ps1','Update.Console.Helpers.ps1','settings.json']:shutil.copy2(root/'installer/runtime'/name,work/name)
  script=original.replace("$Root='C:\\AI\\segretario-mmg-extension'",f"$Root='{installed}'").replace("$State=Join-Path $env:LOCALAPPDATA 'SegretarioMMG'",f"$State='{state}'")
  mocks=f'''
function Invoke-RestMethod {{ if('{mode}' -eq 'network'){{throw 'Synthetic HTTP failure'}}; return ('{json.dumps(release)}'|ConvertFrom-Json) }}
function Get-Process {{ if('{mode}' -eq 'chrome'){{return 'synthetic-chrome'}} }}
function Read-Host {{ Write-Host 'SYNTHETIC_PAUSE';return '' }}
function Receive-FileWithProgress {{param($Uri,$OutFile,$Activity,$TimeoutSeconds,[switch]$ConsoleProgress); [IO.File]::Copy('{package}',$OutFile);Write-Host '10,0 MB / 10,0 MB'}}
function Copy-Item {{param($LiteralPath,$Destination,[switch]$Force);if('{mode}' -eq 'rollback' -and $LiteralPath -like '*unpack*lab_catalog.json'){{throw 'Synthetic copy failure'}};Microsoft.PowerShell.Management\\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force}}
'''
  marker="$exitCode=0";script=script.replace(marker,mocks+'\n'+marker)
  path=work/'Update.ps1';path.write_text(script,encoding='utf-8-sig')
  args=['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(path)]+([] if mode=='automatic' else ['-Interactive'])
  if mode=='check':args+=['-CheckOnly']
  result=subprocess.run(args,capture_output=True);text=result.stdout.decode('utf-8',errors='replace')
  assert result.returncode==(1 if mode in ['network','digest','rollback'] else 0),(mode,text,result.stderr)
  assert ('SYNTHETIC_PAUSE' in text)==(mode!='automatic'),(mode,text)
  if mode in ['success','automatic']:
   assert '[6/6]' in text and '1.0.0 -> 1.1.0' in text and 'MB /' in text
   assert all((installed/n).read_bytes()==new[n] for n in names)
  else:assert all((installed/n).read_bytes()==old[n] for n in names),mode
  if mode in ['network','digest','rollback']:assert (state/'update.log').exists() and 'non completato' in text
  print(mode,'OK')
 # Formatting: explicit MB and unknown totals, percentage, speed, ETA.
 helpers=root/'installer/runtime'
 command=f". '{helpers/'Download.Helpers.ps1'}';. '{helpers/'Update.Console.Helpers.ps1'}';$a=Get-UpdateTransferLine 1500000 3000000 1.5;if($a -notmatch '50%' -or $a -notmatch 'MB/s' -or $a -notmatch 'restano'){{throw $a}};$b=Get-UpdateTransferLine 1500000 -1 1.5;if($b -notmatch 'MB' -or $b -match 'NaN|Infinity'){{throw $b}}"
 result=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-Command',command],capture_output=True);assert result.returncode==0,result.stderr
 print('Progress format OK')
