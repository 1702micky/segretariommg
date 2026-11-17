const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const background=fs.readFileSync(path.join(__dirname,'../background.js'),'utf8');
const content=fs.readFileSync(path.join(__dirname,'../segretario.js'),'utf8');
const release=(version='0.16.20')=>({tag_name:'v'+version,draft:false,prerelease:false,
  assets:[{name:`SegretarioMMG-Setup-${version}.exe`,size:100,browser_download_url:'https://untrusted.invalid/setup.exe'}]});
function worker(fetch,current='0.16.15') {
  const saved={},listeners={};
  const c=vm.createContext({fetch,AbortSignal,AbortController,TextDecoder,TypeError,setTimeout,clearTimeout,setInterval,clearInterval,
    chrome:{storage:{local:{get:async key=>({[key]:saved[key]}),set:async values=>Object.assign(saved,values)}},
      action:{onClicked:{addListener(){}}},runtime:{id:'test',getManifest:()=>({version:current}),
        onMessage:{addListener(fn){listeners.message=fn;}},onConnect:{addListener(){}},getPlatformInfo(){}}}});
  vm.runInContext(background,c);return {c,saved,listeners};
}
const json=data=>({ok:true,json:async()=>data});
test('version comparisons are numeric, validate tags and never offer downgrades',async()=>{
  const {c}=worker(async()=>json(release('0.16.9')));
  assert.equal(c.compareExtensionVersions('0.16.10','0.16.9'),1);
  assert.equal(c.compareExtensionVersions('0.16.10.0','0.16.10'),0);
  assert.throws(()=>c.compareExtensionVersions('0.16.10-beta','0.16.10'));
  const status=await c.getExtensionUpdateStatus();assert.equal(status.state,'ahead');assert.equal(status.downloadUrl,'');
});
test('update metadata uses only a fixed public endpoint and a locally constructed setup URL',async()=>{
  const {c}=worker(async(url,options)=>{
    assert.equal(url,'https://api.github.com/repos/1702micky/segretariommg/releases/latest');
    assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');
    assert.equal(options.body,undefined);return json(release());
  });
  const status=await c.getExtensionUpdateStatus();assert.equal(status.state,'available');
  assert.equal(status.downloadUrl,'https://github.com/1702micky/segretariommg/releases/download/v0.16.20/SegretarioMMG-Setup-0.16.20.exe');
});
test('cached checks avoid rate limits and explicit refresh bypasses the cache',async()=>{
  let calls=0;
  const {c}=worker(async()=>{calls++;return json(release(calls===1?'0.16.15':'0.16.20'));});
  assert.equal((await c.getExtensionUpdateStatus()).state,'current');
  assert.equal((await c.getExtensionUpdateStatus()).state,'current');assert.equal(calls,1);
  assert.equal((await c.getExtensionUpdateStatus(true)).state,'available');assert.equal(calls,2);
});
test('incomplete releases have no setup button; draft or invalid metadata is rejected',async()=>{
  for(const data of [{...release(),draft:true},{...release(),prerelease:true},{...release(),tag_name:'vBAD<script>'}]){
    const {c}=worker(async()=>json(data));await assert.rejects(c.getExtensionUpdateStatus());
  }
  const {c}=worker(async()=>json({...release(),assets:[]}));
  const status=await c.getExtensionUpdateStatus();assert.equal(status.state,'pending');assert.equal(status.downloadUrl,'');
});
test('network failure is unknown, never falsely up to date; foreign senders cannot check',async()=>{
  let calls=0;const {listeners}=worker(async()=>{calls++;throw new TypeError('offline');});
  assert.equal(listeners.message({type:'SEGRETARIO_CHECK_UPDATE'},{id:'foreign'},()=>{}),undefined);
  assert.equal(calls,0);
  const result=await new Promise(resolve=>listeners.message({type:'SEGRETARIO_CHECK_UPDATE'},{id:'test'},resolve));
  assert.equal(result.ok,false);assert.match(result.error,/Impossibile verificare/);
});

function ui(request) {
  const node=()=>({textContent:'',style:{},hidden:false,disabled:false,removeAttribute(key){delete this[key];}});
  const c=vm.createContext({isBusy:false,extensionUpdateChecking:false,
    extensionUpdateCheck:node(),extensionUpdateDownload:node(),extensionUpdateHelp:node(),extensionUpdateStatus:node(),
    requestOllamaMetadata:request});
  const start=content.indexOf('  async function refreshExtensionUpdate(');
  const tail=content.slice(start),end=tail.indexOf('\n  const aiModelRefresh');
  assert.ok(start>=0&&end>0);
  vm.runInContext(tail.slice(0,end),c);return c;
}
test('home UI shows the new version and download instructions; busy work prevents checking',async()=>{
  let calls=0;
  const c=ui(async()=>{calls++;return {update:{current:'0.16.15',latest:'0.16.20',state:'available',checkedAt:Date.now(),downloadUrl:'https://github.com/1702micky/segretariommg/releases/download/v0.16.20/SegretarioMMG-Setup-0.16.20.exe'}};});
  c.isBusy=true;await c.refreshExtensionUpdate(true);assert.equal(calls,0);
  c.isBusy=false;await c.refreshExtensionUpdate(true);
  assert.match(c.extensionUpdateStatus.textContent,/0.16.20/);assert.equal(c.extensionUpdateHelp.hidden,false);
  assert.equal(c.extensionUpdateDownload.style.display,'block');assert.ok(c.extensionUpdateDownload.href);
});
test('home UI removes stale download links and displays failures without blocking model selection',async()=>{
  const c=ui(async()=>{throw Error('offline');});
  c.extensionUpdateDownload.href='stale';await c.refreshExtensionUpdate();
  assert.equal(c.extensionUpdateDownload.href,undefined);
  assert.equal(c.extensionUpdateDownload.style.display,'none');
  assert.match(c.extensionUpdateStatus.textContent,/Impossibile verificare/);
  assert.equal(c.extensionUpdateCheck.disabled,false);
});
