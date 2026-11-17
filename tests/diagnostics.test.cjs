const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../segretario.js'), 'utf8');
function context() {
  const c = vm.createContext({});
  vm.runInContext('let diagnosticEvents=[];const diagnosticSessionStarted=Date.now();let activeWorkflowMode="unprescribed";', c);
  for (const name of ['recordDiagnosticEvent', 'diagnosticSummaryFromText', 'createDiagnosticReport']) {
    const start = new RegExp(`^  function ${name}\\(`, 'm').exec(source).index;
    const end = /\n  \}/.exec(source.slice(start));
    vm.runInContext(source.slice(start, start + end.index + end[0].length), c);
  }
  return c;
}
test('diagnostics accepts only known numeric or boolean fields, never source or errors', () => {
  const c = context();
  c.recordDiagnosticEvent('ia_completata', { durationMs: 1200, images: 2, raw: 'PATIENT SECRET',
    error: 'PATIENT SECRET', filename: 'PATIENT.pdf', value: '4.60', inputCharacters: Infinity });
  c.recordDiagnosticEvent('PATIENT SECRET', {});
  const events = vm.runInContext('diagnosticEvents', c);
  assert.equal(events.length, 1); assert.equal(events[0].durationMs, 1200);
  assert.equal(events[0].mode, 'unprescribed');
  const report = c.createDiagnosticReport('0.16.1', 'unprescribed', 'local-model', events);
  assert.doesNotMatch(report, /PATIENT|4\.60|Infinity/);
  assert.match(report, /1200/);
});
test('summary parsing keeps counts and status without copying the displayed report', () => {
  const c = context();
  const summary = c.diagnosticSummaryFromText('Righe create e confermate: 23/24\nRetry automatici: 2 su 1 righe\nTempo selezione catalogo: 12,5 s\nStop su PATIENT SECRET');
  assert.equal(summary.completed, 23); assert.equal(summary.requested, 24);
  assert.equal(summary.retries, 2); assert.equal(summary.retriedRows, 1);
  assert.equal(summary.catalogSelectionMs, 12500); assert.equal(summary.interrupted, true);
  assert.doesNotMatch(JSON.stringify(summary), /PATIENT/);
});
test('events are bounded and retain each workflow identity', () => {
  const c = context();
  for (const mode of ['prescribed', 'unprescribed', 'prescription_list']) {
    vm.runInContext(`activeWorkflowMode="${mode}"`, c);
    c.recordDiagnosticEvent('operazione_avviata');
  }
  assert.deepEqual(Array.from(vm.runInContext('diagnosticEvents', c), e => e.mode), ['prescribed', 'unprescribed', 'prescription_list']);
  for (let n = 0; n < 400; n++) c.recordDiagnosticEvent('operazione_terminata', { durationMs: n });
  assert.equal(vm.runInContext('diagnosticEvents.length', c), 300);
});
