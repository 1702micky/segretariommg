const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const background = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
const content = fs.readFileSync(path.join(__dirname, '../segretario.js'), 'utf8');

function worker(fetch) {
  const listeners = {};
  const context = vm.createContext({ fetch, AbortSignal, AbortController, TextDecoder, TypeError,
    setTimeout, clearTimeout, setInterval, clearInterval,
    chrome: {
      action: { onClicked: { addListener() {} } },
      runtime: { id: 'test-extension', onMessage: { addListener(fn) { listeners.message = fn; } },
        onConnect: { addListener() {} }, getPlatformInfo() {} },
    },
  });
  vm.runInContext(background, context);
  return { context, listeners };
}
const json = data => ({ ok: true, json: async () => data });

test('discovery returns deduplicated local models and excludes cloud aliases', async () => {
  const { context } = worker(async url => {
    assert.equal(url, 'http://127.0.0.1:11434/api/tags');
    return json({ models: [{ name: 'qwen:4b' }, { name: 'llama:8b' }, { name: 'qwen:4b' },
      { name: 'remote:cloud' }, { name: 'custom', remote_host: 'remote.example' }, { name: '' }] });
  });
  assert.deepEqual(Array.from(await context.listLocalOllamaModels(), m => m.name), ['llama:8b', 'qwen:4b']);
});

test('model details expose vision/text capabilities and are cached', async () => {
  let calls = 0;
  const { context } = worker(async (url, options) => {
    calls++; assert.ok(url.endsWith('/api/show'));
    assert.equal(JSON.parse(options.body).model, 'vision:4b');
    return json({ capabilities: ['completion', 'vision'] });
  });
  const info = await context.getLocalOllamaModelInfo('vision:4b');
  assert.equal(info.vision, true); assert.equal(info.completion, true);
  await context.getLocalOllamaModelInfo('vision:4b'); assert.equal(calls, 1);
});

test('cloud metadata is rejected even when its name looks local', async () => {
  const { context } = worker(async () => json({ remote_host: 'remote.example', capabilities: ['completion'] }));
  await assert.rejects(context.getLocalOllamaModelInfo('custom'), /cloud/);
});

test('image analysis with a text-only model stops before any generation request', async () => {
  const urls = [], messages = [];
  const { context } = worker(async url => {
    urls.push(url); return json({ capabilities: ['completion'] });
  });
  await context.ollamaStreamChat({ model: 'text:8b', messages: [{ images: ['synthetic-image'] }] },
    { postMessage: m => messages.push(m) }, 'test', new AbortController());
  assert.equal(urls.length, 1); assert.ok(urls[0].endsWith('/show'));
  assert.equal(messages.at(-1).type, 'OLLAMA_ERROR');
  assert.match(messages.at(-1).message, /soltanto testo/);
});

test('the selected model is used for generation, not the old default', async () => {
  const sent = [], messages = [];
  const { context } = worker(async (url, options) => {
    if (url.endsWith('/show')) return json({ capabilities: ['completion'] });
    assert.ok(url.endsWith('/chat')); sent.push(JSON.parse(options.body));
    return { ok: true, body: new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"message":{"content":"ok"},"done":true}\n'));
      controller.close();
    } }) };
  });
  await context.ollamaStreamChat({ model: 'chosen:8b', messages: [{ role: 'user', content: 'synthetic test' }] },
    { postMessage: m => messages.push(m) }, 'test', new AbortController());
  assert.equal(sent[0].model, 'chosen:8b'); assert.equal(messages.at(-1).type, 'OLLAMA_RESULT');
});

test('embedding-only models are rejected before generation', async () => {
  const messages = [];
  const { context } = worker(async url => { assert.ok(url.endsWith('/show')); return json({ capabilities: ['embedding'] }); });
  await context.ollamaStreamChat({ model: 'embed', messages: [] }, { postMessage: m => messages.push(m) }, 'test', new AbortController());
  assert.match(messages.at(-1).message, /modello di conversazione/);
});

test('metadata messages are handled only for this extension and connection failures are readable', async () => {
  const { listeners } = worker(async () => { throw new TypeError('fetch failed'); });
  assert.equal(listeners.message({ type: 'OLLAMA_LIST_MODELS' }, { id: 'other' }, () => assert.fail()), undefined);
  const response = await new Promise(resolve => {
    assert.equal(listeners.message({ type: 'OLLAMA_LIST_MODELS' }, { id: 'test-extension' }, resolve), true);
  });
  assert.equal(response.ok, false); assert.match(response.error, /Avvialo/);
});

function installFunction(context, name) {
  const match = new RegExp(`^  (?:async )?function ${name}\\(`, 'm').exec(content);
  assert.ok(match, name);
  const end = /\n  \}/.exec(content.slice(match.index));
  vm.runInContext(content.slice(match.index, match.index + end.index + end[0].length), context);
}
function panel({ models = [{ name: 'qwen3.5:4b' }, { name: 'other:8b' }], saved = 'other:8b', error = null } = {}) {
  const state = { saved: {}, invalidations: 0, requests: [] };
  const select = { options: [], value: '', replaceChildren() { this.options = []; }, appendChild(o) { this.options.push(o); } };
  const context = vm.createContext({ CONFIG: { aiModel: 'qwen3.5:4b' },
    fetch: async () => json({ model: 'qwen3.5:4b' }),
    extensionUrl: name => name,
    aiModelSelect: select, aiModelRefresh: {}, aiModelStatus: {},
    document: { createElement: () => ({}) },
    chrome: { storage: { local: { get: async () => ({ segretarioMmgAiModel: saved }), set: async v => { state.saved = v; } } } },
    invalidate: () => state.invalidations++,
    renderWorkflowMode: () => {},
    requestOllamaMetadata: async message => {
      state.requests.push(message);
      if (error) throw new Error(error);
      return message.type === 'OLLAMA_LIST_MODELS' ? { models } : { info: { name: message.model, completion: true, vision: false } };
    },
  });
  vm.runInContext('let isBusy=false, aiModelsLoading=false, aiModelSelecting=false, selectedAiModelInfo=null, activeWorkflowMode=null; let aiModelSelectionTask=Promise.resolve(); const AI_MODEL_STORAGE_KEY="segretarioMmgAiModel";', context);
  for (const fn of ['chooseAvailableAiModel', 'applyAiModelSelection', 'refreshAiModels']) installFunction(context, fn);
  return { context, state, select };
}

test('the panel restores and persists the installed preference and identifies text-only models', async () => {
  const { context, state, select } = panel();
  await context.refreshAiModels();
  assert.equal(select.value, 'other:8b'); assert.equal(context.CONFIG.aiModel, 'other:8b');
  assert.equal(state.saved.segretarioMmgAiModel, 'other:8b');
  assert.match(context.aiModelStatus.textContent, /soltanto testo/);
  assert.equal(state.invalidations, 1);
});

test('a removed saved model falls back visibly to the installed default', async () => {
  const { context, select } = panel({ saved: 'removed' });
  await context.refreshAiModels();
  assert.equal(select.value, 'qwen3.5:4b'); assert.match(context.aiModelStatus.textContent, /precedente non è disponibile/);
});

test('an empty list and unavailable Ollama leave the selection disabled with a retry action', async () => {
  for (const options of [{ models: [] }, { error: 'Ollama non risponde' }]) {
    const { context, select } = panel(options); await context.refreshAiModels();
    assert.equal(select.disabled, true); assert.equal(context.aiModelRefresh.disabled, false);
    assert.match(context.aiModelStatus.textContent, /Nessun modello|non risponde/);
  }
});

test('model discovery cannot run while a workflow is busy', async () => {
  const { context, state } = panel(); vm.runInContext('isBusy=true', context);
  await context.refreshAiModels(); assert.equal(state.requests.length, 0);
});

test('P0 thinking-only metadata is visibly incompatible, Instruct remains usable', async()=>{
 for(const [name,template,expected] of [['alias','qwen3-vl-thinking',true],['qwen3-vl:2b-instruct','qwen3-vl-instruct',false],['gpt-oss:20b','',true]]){
 const {context}=worker(async()=>json({template,capabilities:['completion']}));
 assert.equal((await context.getLocalOllamaModelInfo(name)).thinkingOnly,expected);
 }
});
test('P0 unexpected thinking aborts before returning content, including a final unterminated event',async()=>{
 for(const newline of ['\n','']){
 const messages=[];const {context}=worker(async url=>url.endsWith('/show')?json({capabilities:['completion']}):{ok:true,body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({message:{thinking:'unexpected',content:'{}'},done:true})+newline));c.close();}})});
 await context.ollamaStreamChat({model:'custom',messages:[]},{postMessage:m=>messages.push(m)},'test',new AbortController());
 assert.equal(messages.at(-1).type,'OLLAMA_ERROR');assert.match(messages.at(-1).message,/ragionamento/);
 }
});
test('P0 synthetic JSON compatibility probe is cached only after success',async()=>{
 let generations=0;const {context}=worker(async url=>url.endsWith('/show')?json({capabilities:['completion']}):(generations++,{ok:true,body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"message":{"content":"{\\"ok\\":true}"},"done":true}\n'));c.close();}})}));
 await context.verifyLocalModel('instruct');await context.verifyLocalModel('instruct');assert.equal(generations,1);
});
