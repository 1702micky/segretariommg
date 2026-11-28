const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise production functions directly, without loading Eumed or patient data.
const source = fs.readFileSync(path.join(__dirname, '../segretario.js'), 'utf8');
function load(names, globals = {}, existingContext = null) {
  const context = existingContext || vm.createContext({ sleep: async () => {}, ...globals });
  for (const name of names) {
    const match = new RegExp(`^  (?:async )?function ${name}\\(`, 'm').exec(source);
    assert.ok(match, `Production function ${name} exists`);
    const tail = source.slice(match.index + match[0].length);
    const next = /\n  (?:async )?function \w+\(/.exec(tail);
    const end = next ? match.index + match[0].length + next.index : source.length;
    vm.runInContext(source.slice(match.index, end), context);
  }
  return context;
}
const item = () => ({ catalogCode: '90.56.3_2', exam: 'ANTIGENE CARCINOEMBRIONARIO CEA' });
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const headers = [{textContent:'Accertamento',cellIndex:0,getAttribute:()=>null}, {textContent:'Data presc.',cellIndex:1,getAttribute:()=>null}, {textContent:'Data esito',cellIndex:2,getAttribute:()=>null}];
const row = (text, index = '1', prescriptionDate = today(), resultDate = '') => ({ textContent: text, getAttribute: () => index,
  querySelectorAll: () => [text, prescriptionDate, resultDate].map(textContent => ({textContent,getAttribute:()=>null})) });
function gridContext() {
  const state = { total: '10', rows: [] };
  const grid = {
    querySelector: () => ({ getAttribute: () => state.total }),
    querySelectorAll: selector => selector.includes('thead') ? headers : state.rows,
  };
  const context = load(['normalizeExamName', 'prescriptionRowText', 'normalizePrescriptionRowText', 'getPrescriptionListRowCount',
    'sanitizeCreationCatalogAlias','prescriptionRowMatchesItem', 'isValidCalendarDateParts', 'normalizeDateValue', 'prescriptionListRowDate', 'getPrescriptionRowEvidence',
    'getPrescriptionWriteSnapshot', 'findNewPrescriptionRow', 'waitForPrescriptionRowAdded',
    'writePrescriptionListItem'], { getPrescriptionListGrid: () => grid });
  return { state, context };
}

test('typed text without a real option is rejected for both code and aliases', async () => {
  const input = { value: 'ANTIGENE', closest: () => null };
  const context = load(['normalizeExamName', 'chooseFilterSelectOptionFilteredFirst',
    'chooseNonPrescribedAccertamento'], {
    triggerNonPrescribedCatalogFilter: async (field, text) => { field.value = text; return true; },
    waitForFilterSelectOption: async () => null,
    nearestControlFromCaption: () => input,
  });
  const result = await context.chooseNonPrescribedAccertamento(input, {
    catalogEntry: { code: 'OTHER', name: 'ANTIGENE', aliases: ['ALIAS'] },
  });
  assert.equal(result, false);
});

test('a real clicked option is accepted', async () => {
  let clicks = 0;
  const context = load(['normalizeExamName', 'chooseFilterSelectOptionFilteredFirst'], {
    triggerNonPrescribedCatalogFilter: async () => true,
    waitForFilterSelectOption: async () => ({}),
    commitFilterSelectOptionWithTab: async () => { clicks++; return true; },
  });
  assert.equal((await context.chooseFilterSelectOptionFilteredFirst({}, 'TEST', { requireRealOption: true })).success, true);
  assert.equal(clicks, 1);
});

test('an existing row with unchanged total is never a new insertion', async () => {
  const { state, context } = gridContext();
  state.rows = [row('90.56.3_2 CEA')];
  const before = context.getPrescriptionWriteSnapshot(item());
  assert.equal(await context.waitForPrescriptionRowAdded(before, item(), 100), null);
});

test('total growth without a matching row is insufficient', () => {
  const { state, context } = gridContext();
  const before = context.getPrescriptionWriteSnapshot(item());
  state.total = '11'; state.rows = [row('90.56.3_3 GLYPICAN')];
  assert.equal(context.findNewPrescriptionRow(before, item()), null);
});

test('new matching evidence plus increased total confirms insertion', () => {
  const { state, context } = gridContext();
  const before = context.getPrescriptionWriteSnapshot(item());
  state.total = '11'; const added = row('90.56.3_2 CEA'); state.rows = [added];
  assert.equal(context.findNewPrescriptionRow(before, item()), added);
});

test('a stale matching row plus unrelated growth is rejected', () => {
  const { state, context } = gridContext();
  state.rows = [row('90.56.3_2 CEA')];
  const before = context.getPrescriptionWriteSnapshot(item());
  state.total = '11'; state.rows.push(row('CREATININA', '2'));
  assert.equal(context.findNewPrescriptionRow(before, item()), null);
});

test('virtualized DOM size never substitutes for missing aria-rowcount', async () => {
  const { state, context } = gridContext(); state.total = null;
  state.rows = [row('CREATININA')];
  assert.equal(context.getPrescriptionListRowCount(), null);
  const result = await context.writePrescriptionListItem(item());
  assert.equal(result.success, false);
});

test('a previously visible exam blocks automatic insertion', async () => {
  const { state, context } = gridContext(); state.rows = [row('90.56.3_2 CEA')];
  const result = await context.writePrescriptionListItem(item());
  assert.equal(result.success, false);
  assert.match(result.field, /gia visibile.*odierna/);
});

test('old prescriptions do not block today even when their result date is today', async () => {
  const { state, context } = gridContext();
  state.rows = [row('90.56.3_2 CEA', '1', '01/01/2001', today())];
  let attempts = 0;
  context.writePrescriptionListItemAttempt = async () => { attempts++; return {success:true}; };
  assert.equal((await context.writePrescriptionListItem(item())).success, true);
  assert.equal(attempts, 1);
  const snapshot = context.getPrescriptionWriteSnapshot(item());
  assert.equal(snapshot.todayMatches, 0); assert.equal(snapshot.unknownDateMatches, 0);
});

test('today prescriptions block even when their result date is old', async () => {
  const { state, context } = gridContext();
  state.rows = [row('90.56.3_2 CEA', '1', today(), '01/01/2001')];
  assert.match((await context.writePrescriptionListItem(item())).field, /odierna/);
});

test('unknown prescription date is reported as unreadable rather than as a duplicate today', async () => {
  const { state, context } = gridContext();
  state.rows = [row('90.56.3_2 CEA', '1', '', today())];
  const result = await context.writePrescriptionListItem(item());
  assert.equal(result.success, false); assert.match(result.field, /Data presc. non leggibile/);
});

test('old matching rows cannot confirm an unrelated new row when their virtual index changes', () => {
  const { state, context } = gridContext();
  state.rows = [row('90.56.3_2 CEA', '1', '01/01/2001')];
  const before = context.getPrescriptionWriteSnapshot(item());
  state.total = '11';state.rows = [row('90.56.3_2 CEA', '2', '01/01/2001')];
  assert.equal(context.findNewPrescriptionRow(before, item()), null);
  state.rows.push(row('90.56.3_2 CEA', '1', today()));
  assert.ok(context.findNewPrescriptionRow(before, item()));
});

test('prescription date follows the named header and aria column, never another date', () => {
  const {context} = gridContext();
  const grid = {querySelectorAll:()=>[
    {textContent:'Data esito',getAttribute:()=> '1'},
    {textContent:'Data presc.',getAttribute:()=> '3'},
  ]};
  const testRow={querySelectorAll:()=>[
    {textContent:today(),getAttribute:()=> '1'},
    {textContent:'01/02/2001',getAttribute:()=> '3'},
  ]};
  assert.equal(context.prescriptionListRowDate(testRow,grid),'2001-02-01');
  const unknownGrid={querySelectorAll:()=>[{textContent:'Data esito',getAttribute:()=> '1'}]};
  assert.equal(context.prescriptionListRowDate(testRow,unknownGrid),'');
});

test('calendar-invalid dates are never interpreted as an old prescription', () => {
  const {context} = gridContext();
  assert.equal(context.prescriptionListRowDate(row('CEA','1','31/02/2001'),{querySelectorAll:()=>headers}),'');
});

test('pending confirmation blocks manual retry until the actual new row is verified', async () => {
  const { state, context } = gridContext(); const target = item();
  target.prescriptionPendingSnapshot = context.getPrescriptionWriteSnapshot(target);
  const pending = await context.writePrescriptionListItem(target);
  assert.equal(pending.success, false); assert.equal(pending.confirmationSent, true);
  state.total = '11'; state.rows = [row('90.56.3_2 CEA')];
  assert.equal((await context.writePrescriptionListItem(target)).success, true);
  assert.equal(target.prescriptionPendingSnapshot, undefined);
});

test('a submitted but unverified confirmation is not retried automatically', async () => {
  const { context } = gridContext(); let attempts = 0;
  context.writePrescriptionListItemAttempt = async () => {
    attempts++; return { success: false, confirmationSent: true, field: 'unverified' };
  };
  assert.equal((await context.writePrescriptionListItem(item())).success, false);
  assert.equal(attempts, 1);
});

test('catalog codes match whole identifiers, not a longer code prefix', () => {
  const { context } = gridContext();
  assert.equal(context.prescriptionRowMatchesItem(row('90.56.3_20 OTHER'), item()), false);
  assert.equal(context.prescriptionRowMatchesItem(row('90.56.3_2 CEA'), item()), true);
});

test('real writer retains pending state after a click and never clicks again on retry', async () => {
  let clicks = 0;
  const state = { total: '10', rows: [] };
  const form = { accertamento: {}, exemption: {}, priority: { value: '' }, confirm: {} };
  const context = load(['normalizeExamName', 'prescriptionRowText', 'normalizePrescriptionRowText', 'getPrescriptionListRowCount',
    'sanitizeCreationCatalogAlias','prescriptionRowMatchesItem', 'isValidCalendarDateParts', 'normalizeDateValue', 'prescriptionListRowDate', 'getPrescriptionRowEvidence', 'getPrescriptionWriteSnapshot',
    'findNewPrescriptionRow', 'waitForPrescriptionRowAdded',
    'waitForPrescriptionListForm', 'writePrescriptionListItemAttempt', 'writePrescriptionListItem'], {
    getPrescriptionListGrid: () => ({
      querySelector: () => ({ getAttribute: () => state.total }),
      querySelectorAll: selector => selector.includes('thead') ? headers : state.rows,
    }),
    getPrescriptionListForm: () => form,
    choosePrescriptionCatalogEntry: async () => true,
    prescriptionTabTo: async () => true,
    vaadinClick: () => { clicks++; },
  });
  const target = item();
  assert.equal((await context.writePrescriptionListItem(target)).confirmationSent, true);
  assert.ok(target.prescriptionPendingSnapshot);
  assert.equal((await context.writePrescriptionListItem(target)).success, false);
  assert.equal(clicks, 1);
  state.total = '11'; state.rows = [row('90.56.3_2 CEA')];
  assert.equal((await context.writePrescriptionListItem(target)).success, true);
  assert.equal(clicks, 1);
});

test('TSH is recognized by the real catalog alias when the grid omits code and canonical name', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../lab_catalog.json'), 'utf8')).entries;
  const entry = catalog.find(entry => entry.code === '90.41.8_0');
  const target = { catalogCode: entry.code, exam: entry.name, catalogEntry: entry };
  const { context, state } = gridContext();
  const before = context.getPrescriptionWriteSnapshot(target);
  state.total = '11';
  state.rows = [row('TIREOTROPINA (TSH 3° GENERAZIONE) RIFLESSO')];
  assert.equal(context.findNewPrescriptionRow(before, target), state.rows[0]);
  assert.equal(context.prescriptionRowMatchesItem(row('TIREOTROPINA (TSH) SENZA REFLEX'), target), false);
});

test('cell boundaries are preserved when row textContent joins the exam to a number', () => {
  const { context } = gridContext();
  const joined = row('90.56.3_2 CEA1');
  joined.querySelectorAll = () => [{ textContent: '90.56.3_2 CEA' }, { textContent: '1' }];
  assert.equal(context.prescriptionRowMatchesItem(joined, item()), true);
});

test('prescription synonyms select real catalog entries without confusing glycated albumin', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../lab_catalog.json'), 'utf8')).entries;
  const context = load(['normalizeExamName', 'sanitizeCreationCatalogAlias', 'preferredPrescriptionCatalogEntry'], {
    directCatalogCodeFromPrescriptionLabel: () => null,
    findCatalogEntryByCode: code => catalog.find(entry => entry.code === code),
    isMolecularMicrobiologyText: () => false,
  });
  assert.equal(context.preferredPrescriptionCatalogEntry('glicata').code, '90.28.1_0');
  assert.equal(context.preferredPrescriptionCatalogEntry('alanina amino transferasi').code, '90.04.5_0');
  assert.equal(context.preferredPrescriptionCatalogEntry('alanina aminotransferasi').code, '90.04.5_0');
  assert.equal(context.preferredPrescriptionCatalogEntry('aspartato amino transferasi').code, '90.09.2_0');
  assert.equal(context.preferredPrescriptionCatalogEntry('albumina glicata'), null);
});

function resolverContext() {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../lab_catalog.json'), 'utf8')).entries;
  const context = load(['normalizeExamName', 'getExamConcept', 'detectSpecimen', 'significantTokens',
    'specimenCompatible', 'stripSpecimenPrefix', 'catalogScore', 'findCatalogEntryByCode', 'catalogEntrySpecimen',
    'sanitizeCreationCatalogAlias', 'serologyFamilyState', 'preferredCreationCatalogDecision',
    'creationCatalogScore', 'matchCatalogForCreation', 'buildUnprescribedDecisionContext',
    'buildPrescriptionDecisionContext', 'isMolecularMicrobiologyText',
    'directCatalogCodeFromPrescriptionLabel', 'preferredPrescriptionCatalogEntry', 'resolvePrescriptionListItems'],
    { labCatalog: catalog });
  return context;
}

test('tabular chemistry keeps serum phosphate and timed urine assays distinct', () => {
  const c = resolverContext();
  load(['detectKnownLabLayout'], {reportContainsLongReportCluster:()=>false}, c);
  assert.equal(c.detectKnownLabLayout('Cerba HealthCare Veneto\nEsame Risultato U.M. Valori di Riferimento\nCHIMICA CLINICA'), 'CERBA_HEALTHCARE');
  c.getLongReportKind = () => '';
  load(['normalizeUnit', 'normalizedUnitLoose', 'unitCompatibleWithConcept',
    'normalizeOcrDisplayUnit', 'isLikelyLabUnitToken', 'detectUrineClusterRange',
    'isUrineComponentLabel', 'parseBilateralRangeFromTail', 'shouldSuppressAutomaticRange',
    'extractPaddleTabularResults'], {}, c);
  const source = [
    'Fosforo\t2,8\tmg/dl\t2,5 - 4,5',
    'Vitamina D (25 OH)\t30,2\tμg/l\tInsufficiente: 4 - 30',
    'Acido Urico Urinario 24h\t689\tmg/24h\t250 - 750',
    'Fosfato Inorganico Urinario 24h\t1,0\tg/24h\t0,4 - 1,3',
    'Calcio Urinario 24h\t↑\t330\tmg/24h\t100 - 300',
    'Acido Citrico Urinario 24h\t↓\t1,1\tmmol/24h\t2,0 - 4,0',
    'Acido Ossalico Urinario\t36\tmg/l\tPopolazione Generale: < 50.0'
  ].join('\n');
  const rows = c.extractPaddleTabularResults(source);
  assert.equal(rows.length, 7);
  assert.deepEqual(Array.from(rows, row => row.value), ['2,8','30,2','689','1,0','330','1,1','36']);
  assert.equal(rows[1].ref_min, '');
  assert.equal(rows[6].ref_max, '');
  assert.deepEqual(Array.from(rows, row => c.matchCatalogForCreation(row.raw_label)?.entry?.code),
    ['90.24.3_2','90.44.6_2','90.43.5_4','90.24.3_4','90.11.4_3','90.02.2_3','90.35.3_0']);
  for (const [label, target] of [
    ['Acido Urico Urinario 24h','URATO (ACIDO URICO) [U] 24H'],
    ['Fosfato Inorganico Urinario 24h','FOSFATO INORGANICO [U] 24H'],
    ['Calcio Urinario 24h','CALCIO TOTALE [U] 24H'],
    ['Acido Citrico Urinario 24h','ACIDO CITRICO [U] 24H']
  ]) assert.equal(c.getExamConcept(label), c.getExamConcept(target), label);
});

test('timed urine measurements retain their source units and numeric ranges', () => {
  const c = reportContext();
  for (const [raw_label, value, unit, code] of [
    ['Acido Urico Urinario 24h','689','mg/24h','90.43.5_4'],
    ['Fosfato Inorganico Urinario 24h','1,0','g/24h','90.24.3_4'],
    ['Calcio Urinario 24h','330','mg/24h','90.11.4_3'],
    ['Acido Citrico Urinario 24h','1,1','mmol/24h','90.02.2_3'],
    ['Acido Ossalico Urinario','36','mg/l','90.35.3_0']
  ]) {
    const result = c.prepareUnprescribedNumericCandidate({raw_label,value,unit,ref_min:'',ref_max:'',ref_unit:''},'');
    assert.equal(result.success,true,JSON.stringify(result));
    assert.equal(result.item.catalogCode,code);
    assert.equal(result.item.unit,unit);
  }
});

test('ULSS6 serum amylase and TSH mU/L remain source-bound', () => {
  const c = resolverContext();
  c.getLongReportKind = () => '';
  vm.runInContext(source.match(/  function specimenCompatible\([\s\S]*?\n  \}/)[0], c);
  load(['normalizeUnit','normalizedUnitLoose','unitCompatibleWithConcept','normalizeOcrDisplayUnit',
    'isLikelyLabUnitToken','detectUrineClusterRange','isUrineComponentLabel',
    'parseBilateralRangeFromTail','shouldSuppressAutomaticRange','extractPaddleTabularResults',
    'resolveExamName'], {}, c);
  const rows = c.extractPaddleTabularResults([
    'P-AMILASI TOTALE\t58\tU/L\t28 - 100',
    'S-TSH\t2.47\tmU/L\t0.35 - 4.50',
    'S-TSH REFLEX\t2.69\tmU/L\t0.35 - 4.50'
  ].join('\n'));
  assert.equal(rows.length, 3);
  assert.equal(c.matchCatalogForCreation(rows[0].raw_label).entry.code, '90.06.4_2');
  assert.equal(c.unitCompatibleWithConcept('TSH','mU/L'),true);
  assert.equal(c.unitCompatibleWithConcept('TSH','ng/L'),false);
  c.getAvailableExams = () => ['TIREOTROPINA (TSH'];
  assert.equal(c.resolveExamName('S-TSH').exam,'TIREOTROPINA (TSH');
  c.getAvailableExams = () => ['TIREOTROPINA [TSH] TEST REFLEX'];
  assert.equal(c.resolveExamName('S-TSH REFLEX').exam,'TIREOTROPINA [TSH] TEST REFLEX');
  c.getAvailableExams = () => ['TIREOTROPINA (TSH'];
  assert.equal(c.resolveExamName('P-AMILASI TOTALE').reason,'known_not_in_grid');
  const prepared=reportContext().prepareUnprescribedNumericCandidate({raw_label:'P-AMILASI TOTALE',value:'58',unit:'U/L',ref_min:'28',ref_max:'100',ref_unit:'U/L'},'');
  assert.equal(prepared.success,true,JSON.stringify(prepared));
  assert.equal(prepared.item.catalogCode,'90.06.4_2');
});

test('Padova pancreatic amylase stays distinct and P-ALP selects total alkaline phosphatase', () => {
  const c = reportContext();
  assert.equal(c.matchCatalogForCreation('P-AMILASI PANCREATICA')?.entry?.code,'90.06.5_0');
  assert.equal(c.matchCatalogForCreation('P-AMILASI TOTALE')?.entry?.code,'90.06.4_2');
  const pancreatic=c.prepareUnprescribedNumericCandidate({raw_label:'P-AMILASI PANCREATICA',value:'535',unit:'U/L',ref_min:'13',ref_max:'53',ref_unit:'U/L'},'');
  assert.equal(pancreatic.success,true,JSON.stringify(pancreatic));
  assert.equal(pancreatic.item.catalogCode,'90.06.5_0');
  assert.equal(c.matchCatalogForCreation('P-ALP')?.entry?.code,'90.23.5_0');
  const prepared=c.prepareUnprescribedNumericCandidate({raw_label:'P-ALP',value:'99',unit:'U/L',ref_min:'43',ref_max:'115',ref_unit:'U/L'},'');
  assert.equal(prepared.success,true,JSON.stringify(prepared));
  assert.equal(prepared.item.catalogCode,'90.23.5_0');
  assert.equal(prepared.item.value,'99');
  assert.equal(c.matchCatalogForCreation('FOSFATASI ALCALINA ISOENZIMA OSSEO')?.entry?.code,'90.24.1_0');
});

test('serum cupremia and plasma zinc resolve to the matching Eumed targets', () => {
  const c=reportContext();
  load(['getLongReportKind','parseInlineSpecimenMeasurement','parseAnchoredMeasurementLine',
    'parsePureBilateralRangeLine','parseNearbyBilateralRange','extractSpecimenAnchoredResults',
    'normalizedUnitLoose','unitCompatibleWithConcept','resolveExamName'],{},c);
  vm.runInContext(source.match(/  function specimenCompatible\([\s\S]*?\n  \}/)[0],c);
  c.getAvailableExams=()=>['RAME [S]','ZINCO [S]',
    'IgE SPECIFICHE ALLERGOLOGICHE QUANTITATIVO PER INALANTI E ALIMENTI. Fino a 12 allergeni'];
  const rows=c.extractSpecimenAnchoredResults([
    's - CUPREMIA 83,7 µg/dL 80,0 - 155,0',
    's - ZINCO Plasmatico 987 µg/L',
    'Popolazione generale :',
    '800 - 1600'
  ].join('\n'));
  assert.equal(rows.length,2,JSON.stringify(rows));
  assert.deepEqual(Array.from(rows,x=>x.value),['83,7','987']);
  assert.deepEqual(Array.from(rows,x=>x.unit),['µg/dL','µg/L']);
  assert.deepEqual(Array.from(rows,x=>c.resolveExamName(x.raw_label).exam),['RAME [S]','ZINCO [S]']);
  assert.equal(c.unitCompatibleWithConcept('COPPER',rows[0].unit),true);
  assert.equal(c.unitCompatibleWithConcept('ZINC',rows[1].unit),true);
  assert.equal(c.unitCompatibleWithConcept('ZINC','UI/mL'),false);
  assert.equal(c.convertMeasurement('COPPER',rows[0].value,rows[0].unit).value,'83,7');
  assert.equal(c.convertMeasurement('ZINC',rows[1].value,rows[1].unit).value,'987');
  assert.equal(c.getExamConcept('ANTICORPI ANTI TRASPORTATORE DELLO ZINCO (ZnT8)'),null);
});

test('ULSS6 urine report keeps ACR only when no separate ratio target exists', () => {
  const c = load(['normalizeExamName','getExamConcept','detectSpecimen','cleanReportLines',
    'sliceKnownSection','cleanupKnownLongReportLines','buildUlss6LongReport',
    'cleanModelLabLabel','cleanRejectedItems','cleanUncertainItems']);
  c.getLongReportKind = () => '';
  c.isLongReportComponent = () => false;
  c.significantTokens = text => String(text).split(/\s+/);
  const source='U_ESAME CHIMICO FISICO URINE\npH\t5.0\nRapporto Alb/Cre (RAC)\t<30\tmg/g Creat.\tFisiologico: 0 - 30\nGlucosio\t0\tmg/dL\nIMPORTANTE: nota';
  c.getAvailableExams=()=>['ESAME URINE COMPLETO'];
  const urine=c.buildUlss6LongReport(source,'URINE');
  assert.match(urine,/Rapporto Alb\/Cre \(RAC\).*<30/);
  const extraction={results:[],uncertain:[],longReports:[{kind:'URINE',text:urine}]};
  assert.equal(c.cleanRejectedItems([{exam:'RAPPORTO ALBUMINA-CREATININA (ACR) URINE',raw_label:'Rapporto Alb/Cre (RAC)',value:'<30',reason:'Esame non presente in Eumed'}],source,extraction).length,0);
  assert.equal(c.cleanUncertainItems([{text:'Rapporto Alb/Cre (RAC)',reason:'Esame non presente in Eumed'}],extraction).length,0);
  c.getAvailableExams=()=>['ESAME URINE COMPLETO','RAPPORTO ALBUMINA-CREATININA (ACR) URINE'];
  assert.doesNotMatch(c.buildUlss6LongReport(source,'URINE'),/Rapporto Alb\/Cre/);
});

test('merged prescribed reading does not revive ACR warnings already in urine report', () => {
  const c = load(['normalizeExamName','detectSpecimen','getExamConcept',
    'getLongReportKind','dedupeRecognizedNotInGrid','cloneResultWithSource',
    'enrichEquivalentResult','extractionHasAmbiguityForExam','mergeIndependentReadings']);
  const urineExam = 'ESAME URINE COMPLETO';
  const urine = {exam:urineExam,kind:'URINE',text:'U_ESAME CHIMICO FISICO URINE\nRapporto Alb/Cre (RAC) <30 mg/g Creat.'};
  const parser = {results:[],longReports:[urine],recognizedNotInGrid:[],uncertain:[],rejected:[]};
  const hybrid = {results:[],longReports:[],
    recognizedNotInGrid:[{raw_label:'Rapporto Alb/Cre (RAC)',value:'<30'}],
    uncertain:[{text:'Rapporto Alb/Cre (RAC)',reason:'Esame non presente in Eumed'}],
    rejected:[{exam:'RAPPORTO ALBUMINA-CREATININA (ACR) URINE',raw_label:'Rapporto Alb/Cre (RAC)',reason:'Esame non presente in Eumed'}]};
  const merged = c.mergeIndependentReadings(parser,hybrid,[urineExam]);
  assert.equal(merged.recognizedNotInGrid.length,0);
  assert.equal(merged.uncertain.length,0);
  assert.equal(merged.rejected.length,0);
  const separate = c.mergeIndependentReadings(parser,hybrid,[urineExam,'RAPPORTO ALBUMINA-CREATININA (ACR) URINE']);
  assert.equal(separate.uncertain.length,1);
  assert.equal(separate.rejected.length,1);
});

test('the complete reported list resolves through the real resolver and real catalog', () => {
  const context = resolverContext();
  const labels = ['tsh', 'emocromo', 'glicemia', 'glicata', 'ast', 'alanina amino transferasi', 'vitamina D'];
  const result = context.resolvePrescriptionListItems(labels.map(raw_label => ({ raw_label })));
  assert.equal(result.uncertain.length, 0);
  assert.deepEqual(Array.from(result.resolved, entry => entry.catalogCode),
    ['90.41.8_0', '90.62.2_2', '90.27.1_2', '90.28.1_0', '90.09.2_0', '90.04.5_0', '90.44.6_2']);
});

test('plain immunology prescription list retains serum matrix and every requested row', async () => {
  const c=resolverContext();
  load(['extractPrescriptionListWithQwenText'],{},c);
  const labels=[
    'EMOCROMO COMPLETO CON FORMULA',
    'ELETTROFORESI DELLE PROTEINE (Sieroproteine) [S]',
    'IMMUNOGLOBULINE - IgG [S]',
    'IMMUNOGLOBULINE - IgA [S]',
    'IMMUNOGLOBULINE - IgM [S]',
    'IgE TOTALI [S]',
    'COMPLEMENTO: C3 [S]',
    'COMPLEMENTO: C4 [S]',
    'IgG SOTTOCLASSI - Sottoclasse IgG1 [S]',
    'IgG SOTTOCLASSI - Sottoclasse IgG2 [S]',
    'IgG SOTTOCLASSI - Sottoclasse IgG3 [S]',
    'IgG SOTTOCLASSI - Sottoclasse IgG4 [S]',
    'IMMUNOFENOTIPIZZAZIONE LEUCO/LINFOCITARIA',
    'BETA 2 MICROGLOBULINA [S]'
  ];
  const payload=await c.extractPrescriptionListWithQwenText(labels.join('\n'));
  assert.deepEqual(Array.from(payload.items,x=>x.raw_label),labels);
  assert.equal(payload.uncertain.length,0);
  const result=c.resolvePrescriptionListItems(payload.items);
  assert.equal(result.uncertain.length,0,JSON.stringify(result.uncertain));
  assert.deepEqual(Array.from(result.resolved,x=>x.catalogCode),[
    '90.62.2_2','90.38.4_0','90.69.4_6','90.69.4_7','90.69.4_5',
    '90.68.3_0','90.60.2_3','90.60.2_5','90.68.4_2','90.68.4_3',
    '90.68.4_4','90.68.4_5','91.47.C_2','90.10.1_2'
  ]);
  assert.equal(c.preferredPrescriptionCatalogEntry('IMMUNOGLOBULINE - IgA [U]')?.code,'90.69.4_2');
  assert.equal(c.preferredPrescriptionCatalogEntry('IMMUNOGLOBULINE - IgA [S]')?.code,'90.69.4_7');
  assert.equal(c.preferredPrescriptionCatalogEntry('IMMUNOGLOBULINE - IgA')?.code,'90.69.4_7');
  assert.equal(c.resolvePrescriptionListItems([{raw_label:'IMMUNOGLOBULINE - IgA'}]).resolved[0]?.catalogCode,'90.69.4_7');
  assert.equal(c.resolvePrescriptionListItems([{raw_label:'IMMUNOGLOBULINE - IgA [U]'}]).resolved[0]?.catalogCode,'90.69.4_2');
  assert.equal(c.preferredPrescriptionCatalogEntry('IgG SOTTOCLASSI - Sottoclasse IgG1')?.code,'90.68.4_2');
  assert.equal(c.preferredPrescriptionCatalogEntry('ELETTROFORESI DELLE PROTEINE (Sieroproteine)')?.code,'90.38.4_0');
  assert.equal(c.preferredPrescriptionCatalogEntry('IMMUNOFENOTIPIZZAZIONE DI BASE T/TBNK')?.code ?? null,null);
});

test('plain chemistry and coagulation list expands only independently resolved exams', async () => {
  const c=resolverContext();
  load(['extractPrescriptionListWithQwenText'],{},c);
  const source=['PTT','Glicemia','Azotemia','sodio, potassio, cloro',
    'GOT e GPT','CPK','Colinesterasi','Creatinina'].join('\n\n');
  const payload=await c.extractPrescriptionListWithQwenText(source);
  assert.deepEqual(Array.from(payload.items,x=>x.raw_label),[
    'PTT','Glicemia','Azotemia','sodio','potassio','cloro',
    'GOT','GPT','CPK','Colinesterasi','Creatinina'
  ]);
  assert.equal(payload.uncertain.length,0);
  const resolved=c.resolvePrescriptionListItems(payload.items);
  assert.equal(resolved.uncertain.length,0,JSON.stringify(resolved.uncertain));
  assert.deepEqual(Array.from(resolved.resolved,x=>x.catalogCode),[
    '90.76.1_0','90.27.1_2','90.44.1_6','90.40.4_2','90.37.4_2',
    '90.13.3_2','90.09.2_0','90.04.5_0','90.15.4_2','90.14.4_0','90.16.3_2'
  ]);
  assert.equal(c.preferredPrescriptionCatalogEntry('LIQUIDO AMNIOTICO ENZIMI - ACETIL-COLINESTERASI')?.code ?? null,null);
});

test('HIV1/2 in a plain infectious screening list selects the combined test', async () => {
  const c=resolverContext();
  load(['extractPrescriptionListWithQwenText'],{},c);
  const labels=['HBV Reflex','HCV','HIV1/2','Ab Anti Treponema Pallidum'];
  const payload=await c.extractPrescriptionListWithQwenText(labels.join('\n'));
  assert.deepEqual(Array.from(payload.items,x=>x.raw_label),labels);
  const result=c.resolvePrescriptionListItems(payload.items);
  assert.equal(result.uncertain.length,0,JSON.stringify(result.uncertain));
  assert.deepEqual(Array.from(result.resolved,x=>x.catalogCode),[
    '91.18.6_0','91.19.5_0','91.23.F_0','91.10.B_2'
  ]);
  assert.equal(c.preferredPrescriptionCatalogEntry('HIV1/2-DNA'),null);
});

test('the seven infectious-screening labels resolve to five distinct catalog entries with visible HBV grouping',()=>{
  const c=resolverContext();
  const labels=['Antigene di superficie epat B (HBsAg)','Ac anti Core epat. B (HBcAb tot.)',
    'Ac anti Core epat. B (HBcAb IgM)','Ac anti HIV','Ac anti epat. C (HCV)','Ac. anti Treponema pall.','Emogruppo'];
  const result=c.resolvePrescriptionListItems(labels.map(raw_label=>({raw_label})));
  assert.equal(result.uncertain.length,0,JSON.stringify(result.uncertain));
  assert.deepEqual(Array.from(result.resolved,x=>x.catalogCode),['91.18.6_0','91.23.F_0','91.19.5_0','91.10.B_2','90.65.3_2']);
  assert.equal(result.resolved[0].requestedLabels.length,3);assert.match(result.resolved[0].mappingNote,/IgM.*positivi/);
  assert.equal(c.resolvePrescriptionListItems([{raw_label:'HBsAg'}]).resolved[0].catalogCode,'91.18.5_0');
  assert.equal(c.resolvePrescriptionListItems([{raw_label:'anti-HBs'}]).resolved[0].catalogCode,'91.18.3_0');
  assert.equal(c.resolvePrescriptionListItems([{raw_label:'Ac anti Treponema pallidum liquor'}]).resolved[0].catalogCode,'91.10.B_3');
  for(const raw_label of ['HBcAb IgM','anti-HBc totali','Ac anti Core epat. B','HBc-Ab']){
    const single=c.resolvePrescriptionListItems([{raw_label}]);
    assert.equal(single.resolved[0]?.catalogCode,'91.18.6_0',raw_label);
  }
  assert.ok(!result.resolved.some(x=>x.catalogCode==='90.65.3_3'));
});

test('creation scoring cannot confuse glicemia with ipoglicemia', () => {
  const context = resolverContext();
  assert.equal(context.catalogScore('glicemia', 'ANAL.GEN. IPOGLICEMIA', { wholeWords: true }), 0);
  assert.equal(context.creationCatalogScore('glicemia', context.labCatalog.find(e => e.code === 'G1.3190_55')), 0);
  assert.equal(context.preferredPrescriptionCatalogEntry('glicemia a digiuno').code, '90.27.1_2');
  assert.equal(context.preferredPrescriptionCatalogEntry('glucosio basale').code, '90.27.1_2');
  assert.equal(context.preferredPrescriptionCatalogEntry('glucosio urine'), null);
  assert.equal(context.preferredPrescriptionCatalogEntry('glucosio dopo carico'), null);
  assert.equal(context.preferredPrescriptionCatalogEntry('ipoglicemia'), null);
});

test('writer waits for the scoped form to return after a transient Vaadin rebuild', async () => {
  let calls = 0;
  const confirm = {};
  const context = load(['waitForPrescriptionListForm'], {
    getPrescriptionListForm: () => ++calls < 3 ? null : { confirm },
  });
  assert.equal((await context.waitForPrescriptionListForm(['confirm'], 240)).confirm, confirm);
  assert.equal(calls, 3);
});

test('writer stops if the local confirmation remains missing', async () => {
  const context = load(['waitForPrescriptionListForm'], { getPrescriptionListForm: () => ({}) });
  assert.equal(await context.waitForPrescriptionListForm(['confirm'], 160), null);
});

function selectionContext({ multiple = false, tabCommits = true, optionsVisible = true, clickCommits = true, commitDelay = 0 } = {}) {
  const state = { tabs: 0, clicks: 0, queries: 0, events: [], remaining: commitDelay, popupVisible: optionsVisible };
  const target = { catalogCode: '90.27.1_2', exam: 'GLUCOSIO [S]', catalogEntry: { name: 'GLUCOSIO [S]', aliases: [] } };
  const input = { value: '90.27.1_2', focus() {} };
  const popup = {};
  const option = { textContent: '90.27.1_2 -- GLUCOSIO [S]' };
  const form = { accertamento: input, exemption: { focus() {} } };
  const context = load(['normalizeExamName', 'significantTokens', 'filterSelectCandidateScore',
    'prescriptionRowText', 'normalizePrescriptionRowText', 'sanitizeCreationCatalogAlias','prescriptionRowMatchesItem',
    'sanitizeCreationCatalogAlias', 'prescriptionCatalogOptionEvidence', 'readPrescriptionCatalogSelection', 'waitPrescriptionCatalogSelection', 'choosePrescriptionCatalogTarget'], {
    triggerNonPrescribedCatalogFilter: async () => { state.queries++; return true; },
    getPrescriptionCatalogOptions: () => state.popupVisible ? (multiple ? [
      { textContent: '90.27.1_3 -- GLUCOSIO [U] 24H' }, option,
    ] : [option]) : [],
    getFilterSelectPopup: () => popup,
    recordDiagnosticEvent: (kind, data) => state.events.push({kind, ...data}),
    getPrescriptionListForm: () => {
      if (state.clicks && clickCommits && state.remaining > 0 && --state.remaining === 0) {input.value = "GLUCOSIO [S]"; state.popupVisible = false;}
      return form;
    },
    dispatchLegacyKey: (field, type, key) => {
      assert.equal(key, 'Tab'); assert.equal(field, input);
      if (type === 'keydown') {
        state.tabs++;
        if (tabCommits) { input.value = 'GLUCOSIO [S]'; state.popupVisible = false; }
      }
    },
    waitFilterPopupClosed: async () => !state.popupVisible,
    isActuallyVisibleInViewport: () => state.popupVisible,
    dispatchVaadinMouseSequence: selected => {
      assert.equal(selected, option);
      state.clicks++;
      if (clickCommits && !commitDelay) {input.value = 'GLUCOSIO [S]'; state.popupVisible = false;}
    },
  });
  return { context, state, input, target, option, form };
}

test('bone metabolism prescription list resolves all twenty entries with the actual catalog', () => {
  const context = resolverContext();
  const labels = ['vitamina D', 'PTH', 'calcemia', 'fosforemia', 'magnesemia', 'calciuria 24/h',
    'fosfaturia 24/h', 'albumina', 'telopeptide C terminale del collagene tipo 1 (CTX sierico)',
    'ALP totale', 'vitamina B6', 'creatinina sierica', 'profilo proteico', 'emocromo',
    'colesterolo totale', 'colesterolo hdl', 'trigliceridi', 'AST', 'ALT', 'TSH reflex'];
  const result = context.resolvePrescriptionListItems(labels.map(raw_label => ({ raw_label })));
  assert.equal(result.uncertain.length, 0, JSON.stringify(result.uncertain));
  assert.deepEqual(Array.from(result.resolved, entry => entry.catalogCode), [
    '90.44.6_2', '90.35.5_2', '90.11.4_2', '90.24.3_2', '90.32.5_2', '90.11.4_3',
    '90.24.3_4', '90.05.1_2', '90.41.6_2', '90.23.5_0', '90.45.1_5', '90.16.3_2',
    '90.38.4_0', '90.62.2_2', '90.14.3_0', '90.14.1_0', '90.43.2_0', '90.09.2_0',
    '90.04.5_0', '90.41.8_0',
  ]);
});

test('routine synonyms preserve timed urine, ionized calcium and bone ALP distinctions', () => {
  const context = resolverContext();
  for (const label of ['calciuria 24/h', 'calciuria 24h', 'calciuria 24 ore']) {
    assert.equal(context.preferredPrescriptionCatalogEntry(label).code, '90.11.4_3');
  }
  for (const label of ['fosfaturia 24/h', 'fosfaturia 24h', 'fosfaturia 24 ore']) {
    assert.equal(context.preferredPrescriptionCatalogEntry(label).code, '90.24.3_4');
  }
  for (const label of ['calciuria', 'calciuria estemporanea', 'calcemia ionizzata']) {
    assert.equal(context.preferredPrescriptionCatalogEntry(label), null);
  }
});

test('routine serum and urine synonyms select the exact matrix and collection code', () => {
  const context = resolverContext();
  const expected = {
    kaliemia: '90.37.4_2', kalemia: '90.37.4_2', potassiemia: '90.37.4_2',
    sodiemia: '90.40.4_2', natremia: '90.40.4_2', natriemia: '90.40.4_2',
    sodiuria: '90.40.4_3', 'sodiuria semplice': '90.40.4_3', 'sodiuria 24h': '90.40.4_4',
    'natriuria delle 24 ore': '90.40.4_4',
    fosfaturia: '90.24.3_3', 'fosfaturia normale': '90.24.3_3',
    'fosfaturia 24/h': '90.24.3_4', 'fosfaturia delle 24h': '90.24.3_4',
    kaliuria: '90.37.4_4', 'potassiuria 24 ore': '90.37.4_3',
    magnesiuria: '90.32.5_4', 'magnesiuria 24h': '90.32.5_5',
    cloremia: '90.13.3_2', cloruria: '90.13.3_3', 'cloruria 24h': '90.13.3_4',
    uricemia: '90.43.5_2', uricosuria: '90.43.5_3', 'uricosuria 24 ore': '90.43.5_4',
    azotemia: '90.44.1_6', sideremia: '90.22.5_2', fosfatemia: '90.24.3_2',
    ALP: '90.23.5_0', 'ALP totale': '90.23.5_0', 'ALP ossea': '90.24.1_0',
    'fosfatasi alcalina ossea': '90.24.1_0',
  };
  for (const [label, code] of Object.entries(expected)) {
    const result = context.resolvePrescriptionListItems([{ raw_label: label }]);
    assert.equal(result.uncertain.length, 0, label);
    assert.equal(result.resolved[0]?.catalogCode, code, label);
  }
});

test('generic calciuria is uncertain rather than guessed as a timed collection or creatinine ratio', () => {
  const context = resolverContext();
  for (const raw_label of ['calciuria', 'calciuria normale', 'calciuria semplice', 'calciuria estemporanea']) {
    const result = context.resolvePrescriptionListItems([{ raw_label }]);
    assert.equal(result.resolved.length, 0, raw_label);
    assert.equal(result.uncertain.length, 1, raw_label);
    assert.match(result.uncertain[0].reason, /I\/II minzione/);
  }
  assert.equal(context.resolvePrescriptionListItems([{ raw_label: 'calciuria 24h' }]).resolved[0].catalogCode, '90.11.4_3');
});

test('plain transaminase lines resolve directly with values and no invented ranges', async () => {
  const context = reportContext();
  load(['extractSimpleNumericReport'], {}, context);
  const raw = context.extractSimpleNumericReport('AST 17 U/L\nALT 19 U/L');
  const prepared = Array.from(raw, row => context.prepareUnprescribedNumericCandidate(row, ''));
  assert.equal(prepared.every(x => x.success), true, JSON.stringify(prepared));
  assert.deepEqual(prepared.map(x => x.item.catalogCode), ['90.09.2_0', '90.04.5_0']);
  assert.deepEqual(prepared.map(x => Number(x.item.value)), [17, 19]);
  assert.equal(raw.every(x => x.ref_min === '' && x.ref_max === ''), true);
  assert.equal(context.extractSimpleNumericReport('got 17,5 UI/L\ngpt 19 U/L').length, 2);
  for (const text of ['', 'AST 17', 'ALT 19 mg/dL', 'AST 17 U/L\naltro esame 12', 'AST 17 U/L precedente 15', 'AST 10 - 40 U/L']) {
    assert.equal(context.extractSimpleNumericReport(text), null);
  }
  Object.assign(context, {
    ensureLabCatalog: async () => {}, detectKnownLabLayout: () => null,
    parseExplicitReportDateText: () => null,
    extractUnprescribedWithQwen: () => { throw new Error('AI must not run for fully parsed plain lines'); },
    buildUnprescribedFixedComplexItems: () => [], buildRawSerologyComplexItems: () => [],
    detectSerologyComplexItems: () => ({ items: [], unmatched: [] }),
    rawResultCoveredByUnprescribedComplex: () => false,
  });
  load(['extractUnprescribedDeterministicRaw', 'extractFecalOccultSamples', 'isFecalOccultSampleWarning', 'isVerifiedUnprescribedWarning', 'extractUnprescribedFromReport'], {}, context);
  const result = await context.extractUnprescribedFromReport('AST 17 U/L\nALT 19 U/L');
  assert.equal(result.numeric.length, 2);
  assert.equal(result.stats.qwenUsed, false);
  assert.equal(result.uncertain.length, 1); // Missing report date remains visible.
  assert.equal(result.uncertain[0].text, 'Data del referto');
  const expanded = await context.extractUnprescribedFromReport('glicemia 91 mg/dL\nFT4 15 pmol/L\ncalcemia 9,3 mg/dL');
  assert.equal(expanded.numeric.length, 3);
  assert.equal(expanded.stats.qwenUsed, false);
});

test('simple numeric catalog reports cover chemistry, electrolytes, lipids and hormones', () => {
  const context = reportContext();
  load(['extractSimpleNumericReport'], {}, context);
  const lines = ['glicemia 91 mg/dL', 'creatinina sierica 0,82 mg/dL', 'urea 31 mg/dL',
    'colesterolo totale 178 mg/dL', 'colesterolo HDL 56 mg/dL', 'trigliceridi 108 mg/dL',
    'sodio 139 mmol/L', 'potassio 4,1 mmol/L', 'calcemia 9,3 mg/dL',
    'fosforemia 3,2 mg/dL', 'magnesemia 2 mg/dL', 'TSH 2,1 mUI/L',
    'FT3 4,7 pmol/L', 'FT4 15 pmol/L', 'PTH 42 pg/mL', 'vitamina D 28 ng/mL',
    'GGT 24 U/L', 'ALP 72 U/L'];
  for (const line of lines) {
    const parts = line.match(/^(.+?)\s+([\d,]+)\s+(\S+)$/);
    const debug = parts && context.prepareUnprescribedNumericCandidate({raw_label:parts[1], value:parts[2], unit:parts[3]}, '', context.buildUnprescribedDecisionContext(line));
    assert.ok(context.extractSimpleNumericReport(line), line + ': ' + JSON.stringify(debug));
  }
  const parsed = context.extractSimpleNumericReport(lines.join('\n'));
  assert.equal(parsed.length, lines.length);
  for (const raw of parsed) {
    const prepared = context.prepareUnprescribedNumericCandidate(raw, '', context.buildUnprescribedDecisionContext(lines.join('\n')));
    assert.equal(prepared.success, true, JSON.stringify(prepared));
    assert.equal(prepared.item.rangeAvailable, false);
  }
  for (const line of ['creatinina 90 mg/g', 'glicemia 91 U/L', 'sodio 139 mg/dL',
    'calciuria 24h 180 mg/24h', 'sodiuria 60 mmol/L', 'U-glucosio 10 mg/dL',
    'emocromo 12 g/dL', 'PSA 2 ng/mL', 'PCR 2 mg/L', 'LDL 115 mg/dL', 'glicemia precedente 91 mg/dL',
    'creatinina 0,8 mg/dL eGFR 90', 'glicemia 91 mg/dL\nnota non interpretata']) {
    assert.equal(context.extractSimpleNumericReport(line), null, line);
  }
});

function reportContext() {
  const context = resolverContext();
  load(['cleanModelLabLabel', 'isSerologyCatalogEntry', 'looksLikeSerologyText',
    'normalizeValueString', 'parseItalianNumber', 'formatNumber', 'normalizeUnit', 'convertMeasurement',
    'parseBilateralRangeText', 'prepareRangeInput', 'shouldSuppressAutomaticRange', 'convertRange', 'unitsCompatible', 'sanitizeUnprescribedRange',
    'isKnownResidualNonExamLabel','dedupeUnprescribedWarnings', 'prepareUnprescribedNumericCandidate', 'sameNumericValue', 'valuesClinicallyEquivalent', 'dedupeUnprescribedNumeric', 'parsePrescribedTransferText',
    'cleanReportLines', 'normalizeAouNumericToken', 'isNumericOrComparatorToken', 'isAouUnitToken',
    'isAouMajorLabel', 'parseAouBilateralRange', 'parseBilateralRangeFromTail',
    'parseInlineKnownMeasurement', 'parseAouContinuationMeasurement', 'extractAouPadovaResults',
    'extractAcrResult'], {}, context);
  vm.runInContext(source.match(/  const PREFERRED_UNITS = \{[\s\S]*?\n  \};/)[0], context);
  return context;
}

const inlineLabFixture = `EMATOLOGIA
ES. EMOCROMOCITOMETRICO
Leucociti 6,10 x10^3/mmc [4,50 - 11,00]
Eritrociti 4,90 x10^6/mmc [4,50 - 6,10]
Emoglobina 14,8 g/dL [14,0 - 18,0]
148,0 g/L [140,0 - 180,0]
Ematocrito 44,2 % [40,0 - 50,0]
Volume cellulare medio 90,2 fL [80,0 - 99,0]
Contenuto medio di Hb 29,4 pg [27,0 - 33,0]
Concentr. media di Hb 33,1 g/dL [31,5 - 36,0]
Indice di anisocitosi 13,1 % [11,5 - 16,5]
Piastrine 241 x10^3/mmc [130 - 400]
Neutrofili 52,5 %
3,20 x10^3/mmc [1,90 - 8,00]
Linfociti 35,0 %
2,13 x10^3/mmc [1,0 - 4,0]
CHIMICA CLINICA
P-GLUCOSIO 94 mg/dL [74 - 106]
P-CREATININA * 1,22 mg/dL [0,72 - 1,18]
Metodo: enzimatico
eGFR (Velocita' di filtrazione glomerulare) 72,0 ml/min [> 60,00]
Il calcolo dell'eGFR (formula CKD-EPI) non e' applicabile nelle donne in gravidanza e nei soggetti di eta' superiore a 75 anni.
P-TRIGLICERIDI 52 mg/dL [30,0 - 150,0]
P-COLESTEROLO 172 mg/dL [80 - 200]
P-COLESTEROLO FRAZIONATO
P-HDL-COLESTEROLO 62 mg/dL [45 - 130]
P-COLESTEROLO NON-HDL 110 mg/dl [desiderabile < 130]
Validazione assistita da sistema esperto`;

function inlineLabContext() {
  const context = reportContext();
  load(['countReportTerms', 'reportContainsLongReportCluster', 'detectKnownLabLayout', 'extractExplicitCbcSection',
    'parseInlineSpecimenMeasurement', 'parseAnchoredMeasurementLine', 'parsePureBilateralRangeLine',
    'parseNearbyBilateralRange', 'extractSpecimenAnchoredResults', 'getLongReportKind',
    'reportReallyContainsLongReportKind', 'extractPsaReflexData', 'expandUnprescribedPayload', 'validateUnprescribedAiSource','sourceLabelForAiRow','validateAiMeasurementEvidence','validatedAiReportDate','normalizeDateValue','isValidCalendarDateParts','parseExplicitReportDateText'], {}, context);
  load(['knownLongReportKinds', 'getFixedComplexCatalogEntry', 'genericLongReportSlice', 'extractKnownLongReportText',
    'normalizeLongReportText', 'buildUnprescribedFixedComplexItems', 'aiLineHasMeasurement', 'aiLineIsClinicalContext',
    'isKnownAiChromeLine', 'stripKnownPageChrome', 'collectConsumedAiLineKeys', 'removeConsumedAiLines',
    'getUnclaimedAiEvidence', 'buildKnownUnprescribedResidualEvidence', 'extractFecalOccultSamples',
    'isFecalOccultSampleWarning', 'isVerifiedUnprescribedWarning'], {}, context);
  vm.runInContext(source.match(/  const UNPRESCRIBED_FIXED_COMPLEX_CODES = \{[\s\S]*?\n  \};/)[0],context);
  context.getAvailableExams=()=>[];
  return context;
}

test('third-party inline chemistry and Italian CBC preserve all numeric tests and the complete CBC', () => {
  const c=inlineLabContext();
  assert.equal(c.detectKnownLabLayout(inlineLabFixture),'INLINE_CBC_CHEMISTRY');
  const cbc=c.extractExplicitCbcSection(inlineLabFixture);
  assert.match(cbc,/Leucociti 6,10/);assert.match(cbc,/Emoglobina 14,8/);
  assert.match(cbc,/148,0 g\/L/);assert.match(cbc,/2,13 x10/);
  assert.doesNotMatch(cbc,/CHIMICA|P-GLUCOSIO|eGFR/);
  const raw=c.extractSpecimenAnchoredResults(inlineLabFixture);
  assert.equal(raw.length,6);
  const prepared=Array.from(raw,x=>c.prepareUnprescribedNumericCandidate(x,'',c.buildUnprescribedDecisionContext(inlineLabFixture,raw)));
  assert.equal(prepared.filter(x=>x.success).length,5,JSON.stringify(prepared));
  assert.ok(prepared.some(x=>x.success&&x.item.catalogCode==='90.14.3_0'&&x.item.value==='172'));
  assert.ok(prepared.some(x=>!x.success&&/dato derivato/.test(x.uncertain.reason)));
  assert.equal(c.reportReallyContainsLongReportKind(inlineLabFixture,'URINE'),false);
  const fixed=c.buildUnprescribedFixedComplexItems(inlineLabFixture,'INLINE_CBC_CHEMISTRY',raw,'');
  assert.equal(fixed.length,1);assert.equal(fixed[0].complexKind,'EMOCROMO');
  const residual=c.buildKnownUnprescribedResidualEvidence(inlineLabFixture,'INLINE_CBC_CHEMISTRY',raw,fixed);
  assert.equal(residual.count,0,JSON.stringify(residual));
});

test('AOU stool occult blood samples retain ordinal and qualitative result without using cutoff as a value', () => {
  const c=load(['extractFecalOccultSamples','isFecalOccultSampleWarning','isVerifiedUnprescribedWarning','normalizeExamName','isKnownResidualNonExamLabel']);
  const report=['P-TRIGLICERIDI 0,82 mmol/L','F-SANGUE OCCULTO NELLE FECI',
    '-PRIMO CAMPIONE Negativo Cut-off: 100 ng/ml',
    '-SECONDO CAMPIONE Negativo Cut-off: 100 ng/ml',
    '-TERZO CAMPIONE Positivo Cut-off: 100 ng/ml','P-TSH 1,48 mIU/L'].join('\n');
  assert.deepEqual(Array.from(c.extractFecalOccultSamples(report),x=>[x.code,x.result]),[
    ['90.21.4_2','NEGATIVO'],['90.21.4_3','NEGATIVO'],['90.21.4_4','POSITIVO']]);
  assert.equal(c.extractFecalOccultSamples('P-TSH 1,48 mIU/L').length,0);
  assert.equal(c.isFecalOccultSampleWarning('-TERZO CAMPIONE Positivo Cut-off: 100 ng/ml'),true);
  assert.equal(c.isKnownResidualNonExamLabel('alterata a digiuno: 5,7 - 6,9'),true);
  assert.equal(c.isKnownResidualNonExamLabel('gravidanza: 3,7 - 5,1'),true);
  assert.equal(c.isKnownResidualNonExamLabel('P-ALT * 5 U/L 7 - 35'),false);
  const numeric=[{source:'parser',raw_label:'P-ALT',originalValue:'5',value:'5'}];
  assert.equal(c.isVerifiedUnprescribedWarning({text:'P-ALT * 5 U/L 7 - 35'},numeric),true);
  assert.equal(c.isVerifiedUnprescribedWarning({text:'P-ALT * 8 U/L 7 - 35'},numeric),false);
});

test('a prepared PSA long report from the residual pass is queued even when its text was assembled without an AI tag', () => {
  const c=load(['filterPostQwenWriteSet']);
  const urine={exam:'URINE ESAME COMPLETO',kind:'URINE',text:'Esame urine',workflowSource:'parser'};
  const psa={exam:'ANTIGENE PROSTATICO SPECIFICO PSA REFLEX',kind:'PSA_REFLEX',text:'PSA totale: 4,338 ug/L\nPSA libero: 0,388 ug/L',workflowSource:'parser'};
  const result=c.filterPostQwenWriteSet({results:[],longReports:[urine,psa]},new Set([urine.exam]));
  assert.deepEqual(Array.from(result.longReports,x=>x.exam),[psa.exam]);
  assert.equal(c.filterPostQwenWriteSet({results:[],longReports:[urine]},new Set([urine.exam])).longReports.length,0);
});

test('unprescribed preview lists all three qualitative stool outcomes for manual entry', async () => {
  const c=inlineLabContext();
  load(['extractSimpleNumericReport','extractUnprescribedDeterministicRaw','extractPaddleTabularResults',
    'removeUnsupportedDuplicateAssignments','sourceSupportScoreForResult','isHbA1cLabel','parseExplicitReportDateText',
    'rawResultCoveredByUnprescribedComplex','isLongReportComponent','getKnownLayoutDisplayName',
    'validateKnownLayoutQwenResidualResults','extractUnprescribedFromReport'],{},c);
  c.ensureLabCatalog=async()=>{};
  c.extractUnprescribedWithQwen=async()=>({results:[],complex:[],uncertain:[]});
  c.buildRawSerologyComplexItems=()=>[];
  c.detectSerologyComplexItems=()=>({items:[],unmatched:[]});
  const sampleText=['F-SANGUE OCCULTO NELLE FECI','-PRIMO CAMPIONE Negativo Cut-off: 100 ng/ml',
    '-SECONDO CAMPIONE Negativo Cut-off: 100 ng/ml','-TERZO CAMPIONE Positivo Cut-off: 100 ng/ml'].join('\n');
  const result=await c.extractUnprescribedFromReport(`${inlineLabFixture}\n${sampleText}`);
  const warnings=result.uncertain.filter(x=>/SANGUE OCCULTO/.test(x.text));
  assert.deepEqual(Array.from(warnings,x=>[x.text.match(/(PRIMO|SECONDO|TERZO)/)[1],x.reason.match(/(negativo|positivo)/)[1]]),[
    ['PRIMO','negativo'],['SECONDO','negativo'],['TERZO','positivo']]);
  assert.equal(result.numeric.some(x=>x.value==='100'),false);
});

test('the full unprescribed flow processes the new layout without AI rescue or invented panels', async () => {
  const c=inlineLabContext();
  load(['extractSimpleNumericReport','extractUnprescribedDeterministicRaw','extractPaddleTabularResults',
    'removeUnsupportedDuplicateAssignments','sourceSupportScoreForResult','isHbA1cLabel','parseExplicitReportDateText',
    'rawResultCoveredByUnprescribedComplex','isLongReportComponent','extractUnprescribedFromReport'],{},c);
  c.ensureLabCatalog=async()=>{};
  c.extractUnprescribedWithQwen=()=>{throw Error('No AI call expected for fully explained report');};
  c.buildRawSerologyComplexItems=()=>[];
  c.detectSerologyComplexItems=()=>({items:[],unmatched:[]});
  const result=await c.extractUnprescribedFromReport(inlineLabFixture);
  assert.equal(result.numeric.length,5);assert.equal(result.complex.length,1);
  assert.equal(result.complex[0].complexKind,'EMOCROMO');assert.equal(result.stats.qwenUsed,false);
  assert.equal(result.uncertain.filter(x=>x.text!=='Data del referto').length,1);
  assert.ok(result.uncertain.some(x=>/dato derivato/.test(x.reason)));
});

function transferContext(available = []) {
  const c=inlineLabContext();
  load(['extractSimpleNumericReport','extractUnprescribedDeterministicRaw','extractPaddleTabularResults',
    'removeUnsupportedDuplicateAssignments','sourceSupportScoreForResult','isHbA1cLabel','parseExplicitReportDateText',
    'normalizeDateValue','isValidCalendarDateParts','formatDateForGrid',
    'transferNumericSourceSupported','transferComplexSourceSupported','buildPrescribedTransferText','parsePrescribedTransferText',
    'renderPrescribedTransferBlock','copyPrescribedTransferBlock','buildSynlabLongReport','sliceKnownSection','cleanupKnownLongReportLines',
    'normalizedUnitLoose','unitCompatibleWithConcept','normalizePsaDisplayUnit','psaMeasurementNear','buildPsaReflexLongReportFromRawResults','buildPsaReflexLongReport',
    'buildBilirubinComplexText','formatRawComplexResult'],{},c);
  c.resolveExamName=name=>({success:available.includes(name),reason:available.includes(name)?'matched':'known_not_in_grid'});
  c.escapeHtml=text=>String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return c;
}

test('copy transfer excludes existing exams and derived/unmatched data and preserves raw units, ranges and date',()=>{
  const c=transferContext();
  const existing=[c.findCatalogEntryByCode('90.16.3_2').name,c.getFixedComplexCatalogEntry('EMOCROMO').name];
  c.resolveExamName=name=>({success:existing.includes(name),reason:'known_not_in_grid'});
  const text=c.buildPrescribedTransferText({reportDate:'2026-02-01',recognizedNotInGrid:[]},inlineLabFixture);
  const payload=JSON.parse(text);
  assert.equal(payload.data_referto,'2026-02-01');assert.equal(payload.numerici.length,4);assert.equal(payload.complessi.length,0);
  assert.ok(!payload.numerici.some(x=>x.codice==='90.16.3_2'));
  const glucose=payload.numerici.find(x=>x.codice==='90.27.1_2');
  assert.equal(glucose.valore,'94');assert.equal(glucose.unita,'mg/dL');assert.equal(glucose.min,'74');assert.equal(glucose.max,'106');
  const restored=c.parsePrescribedTransferText(text);
  assert.equal(restored.numeric.length,4);assert.equal(restored.reportDate,'2026-02-01');assert.equal(restored.stats.qwenUsed,false);
});

test('serum amylase absent from the prescribed grid enters the transfer once',()=>{
  const c=transferContext();
  load(['normalizeOcrDisplayUnit','isLikelyLabUnitToken','detectUrineClusterRange','isUrineComponentLabel'],{},c);
  const source='P-AMILASI TOTALE\t58\tU/L\t28 - 100';
  const payload=JSON.parse(c.buildPrescribedTransferText({reportDate:'2026-10-30',recognizedNotInGrid:[]},source));
  assert.equal(payload.numerici.length,1);
  assert.equal(payload.numerici[0].codice,'90.06.4_2');
  assert.equal(payload.numerici[0].valore,'58');
  assert.equal(payload.numerici[0].unita,'U/L');
});

test('transfer keeps complete complex reports and is accepted directly by unprescribed analysis',async()=>{
  const c=transferContext();
  const text=c.buildPrescribedTransferText({reportDate:'2026-02-01'},inlineLabFixture);
  const data=JSON.parse(text);assert.equal(data.complessi.length,1);
  assert.match(data.complessi[0].testo,/148,0 g\/L/);assert.match(data.complessi[0].testo,/2,13 x10/);
  load(['extractUnprescribedFromReport'],{},c);
  c.ensureLabCatalog=async()=>{};
  c.extractUnprescribedWithQwen=()=>{throw Error('A copied transfer must never call AI');};
  const result=await c.extractUnprescribedFromReport(text);
  assert.equal(result.numeric.length,5);assert.equal(result.complex.length,1);assert.equal(result.uncertain.length,0);
});

test('edited transfer codes, incompatible units and malformed JSON are rejected before any writing',()=>{
  const c=transferContext();const data=JSON.parse(c.buildPrescribedTransferText({reportDate:'2026-02-01'},inlineLabFixture));
  data.numerici[0].codice='INVALID';assert.throws(()=>c.parsePrescribedTransferText(JSON.stringify(data)),/Associazione/);
  assert.throws(()=>c.parsePrescribedTransferText('{"formato":"SEGRETARIO_MMG_REFERTO_V1",'),/incompleto/);
  const valid=JSON.parse(c.buildPrescribedTransferText({reportDate:'2026-02-01'},inlineLabFixture));
  valid.numerici.find(x=>x.codice==='90.27.1_2').unita='U/L';
  assert.throws(()=>c.parsePrescribedTransferText(JSON.stringify(valid)),/non validabili/);
  assert.equal(c.parsePrescribedTransferText('AST 17 U/L'),null);
});

test('unsupported AI values and genuine catalog ambiguities never enter the transfer',()=>{
  const c=transferContext();c.resolveExamName=()=>({success:false,reason:'ambiguous'});
  assert.equal(c.buildPrescribedTransferText({reportDate:'2026-02-01'},inlineLabFixture),'');
  c.resolveExamName=()=>({success:false,reason:'known_not_in_grid'});
  const block=c.buildPrescribedTransferText({reportDate:'2026-02-01',recognizedNotInGrid:[
    {raw_label:'P-GLUCOSIO',value:'999',unit:'mg/dL',catalogCode:'90.27.1_2'}]},inlineLabFixture);
  assert.equal(JSON.parse(block).numerici.find(x=>x.codice==='90.27.1_2').valore,'94');
});

test('copy action writes only after explicit invocation and rendered clinical text is escaped',async()=>{
  const c=transferContext();let copied='';c.navigator={clipboard:{writeText:async text=>{copied=text;}}};
  assert.equal(copied,'');assert.equal(await c.copyPrescribedTransferBlock({value:'synthetic transfer'}),true);assert.equal(copied,'synthetic transfer');
  const html=c.renderPrescribedTransferBlock('</textarea><script>synthetic</script>');
  assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
});

test('a reported PSA total alone is copied without invented free PSA or ratio',()=>{
  const c=transferContext();
  const text='s - ANTIGENE PROSTATICO SPECIFICO (PSA)\nMetodo: chemiluminescenza\n1,320 ng/mL';
  const payload=JSON.parse(c.buildPrescribedTransferText({reportDate:'2026-02-01'},text));
  assert.equal(payload.complessi.length,1);assert.equal(payload.complessi[0].tipo,'PSA_REFLEX');
  assert.match(payload.complessi[0].testo,/1,320 ng\/mL/);assert.doesNotMatch(payload.complessi[0].testo,/libero|rapporto/i);
  assert.equal(c.parsePrescribedTransferText(JSON.stringify(payload)).complex.length,1);
});

test('Italian CBC ends before a following SI-prefixed VES test',()=>{
  const c=transferContext();
  const source=inlineLabFixture.replace('CHIMICA CLINICA','si - V.E.S. (VELOCITA DI ERITROSEDIMENTAZIONE)\nMetodo: FOTOMETRIA\n7 mm/h\nCHIMICA CLINICA');
  assert.doesNotMatch(c.extractExplicitCbcSection(source),/V\.E\.S\./);
  const synlab=source.replace('ES. EMOCROMOCITOMETRICO','si - ESAME EMOCROMOCITOMETRICO');
  assert.doesNotMatch(c.buildSynlabLongReport(synlab,'EMOCROMO'),/V\.E\.S\./);
  const block=JSON.parse(c.buildPrescribedTransferText({reportDate:'2026-02-01'},source));
  assert.ok(block.numerici.some(x=>x.codice==='90.82.5_0'&&x.valore==='7'));
});

test('the production Eumed resolver keeps existing matrix-specific and complex rows out of transfer',()=>{
  const c=transferContext();
  const specimenStart=source.indexOf('  function specimenCompatible(');
  vm.runInContext(source.slice(specimenStart,source.indexOf('  const CATALOG_QUERY_ALIASES',specimenStart)),c);
  load(['matchCatalog','gridMatchesCatalogEntry','resolveExamName'],{},c);
  vm.runInContext(source.match(/  const EXAM_ALIASES = \{[\s\S]*?\n  \};/)[0],c);
  c.getAvailableExams=()=>['CREATININA [S] con eventuale eGFR','ESAME EMOCROMOCITOMETRICO','CALCIO TOTALE [S]','VITAMINA D (25 OH)',
    'TIREOTROPINA (TSH). Non associabile a TSH Reflex','TIROXINA LIBERA (FT4). Non associabile a 90.41.8'];
  const data=JSON.parse(c.buildPrescribedTransferText({reportDate:'2026-02-01'},inlineLabFixture));
  assert.equal(data.numerici.length,4);assert.equal(data.complessi.length,0);
  assert.ok(!data.numerici.some(x=>x.codice==='90.16.3_2'));
  load(['targetConceptTerms','residualTargetHasTextAnchor'],{},c);
  for(const target of c.getAvailableExams().slice(2))assert.equal(c.residualTargetHasTextAnchor(inlineLabFixture,target),false,target);
});

test('no empty Eumed rows runs read-only analysis and offers transfer without invoking any writer',async()=>{
  const c=transferContext();let reads=0,writes=0;
  Object.assign(c,{isBusy:false,textarea:{value:inlineLabFixture},resultsBox:{innerHTML:''},
    invalidate(){},setBusy(value){c.isBusy=value;},examRowSelectionCache:new Map(),ensureLabCatalog:async()=>{},
    scanAllEumedRows:async()=>({count:0}),getEmptyEumedExams:()=>[],
    extractUnprescribedFromReport:async()=>{reads++;return {reportDate:'2026-02-01',numeric:[]};},
    setExamRecords:async()=>{writes++;throw Error('Unexpected writer');},
    writeNonPrescribedItems:async()=>{writes++;throw Error('Unexpected writer');}});
  load(['runAutoWorkflow'],{},c);
  await c.runAutoWorkflow();
  assert.equal(reads,1);assert.equal(writes,0);assert.equal(c.isBusy,false);
  assert.match(c.resultsBox.innerHTML,/data-transfer-copy/);assert.doesNotMatch(c.resultsBox.innerHTML,/Errore nel workflow/);
});

test('AI object rows remain source-bound and invented urine, chemistry panels and generic notes are rejected', () => {
  const c=inlineLabContext();
  const lines=inlineLabFixture.split('\n');
  const p=c.expandUnprescribedPayload({d:'',de:'',r:[
    {exam:'glucosio',value:'94',unit:'mg/dl',ref_min:'74',ref_max:'106',ref_unit:'mg/dL',raw_label:'P-GLUCOSIO'},
    {exam:'creatinina',value:'52',unit:'mg/dL',raw_label:'P-CREATININA'},
    {exam:'urine',value:'ESAME COMPLETO E SEDIMENTO',unit:'',raw_label:'URINE'}],
    c:[{kind:'EMOCROMO',label:'Emocromo e formula',line_start:2,line_end:16},
      {kind:'CHIMICA CLINICA - GLUCOSI',label:'CHIMICA CLINICA - GLUCOSI',line_start:17,line_end:18},
      {kind:'URINE',label:'URINE',line_start:1,line_end:16}],
    u:[{text:'eGFR calcolo non applicabile',reason:'nota generale'},
      {text:'P-COLESTEROLO NON-HDL unita di misura ambigua',reason:'mg/dl invece di mg/dL'}]},lines);
  const filtered=c.validateUnprescribedAiSource(p,inlineLabFixture);
  assert.equal(filtered.results.length,1);assert.equal(filtered.results[0].value,'94');
  assert.equal(filtered.complex.length,1);assert.equal(filtered.complex[0].kind,'EMOCROMO');
  assert.equal(filtered.uncertain.length,1);
  assert.equal(filtered.uncertain[0].text,'P-CREATININA');
  assert.match(filtered.uncertain[0].reason,/non confermati/);
  const legacy=c.expandUnprescribedPayload({r:[['glucosio','94','mg/dl','74','106','mg/dL','P-GLUCOSIO']],c:[],u:[]},lines);
  assert.equal(c.validateUnprescribedAiSource(legacy,inlineLabFixture).results.length,1);
  const schema=source.match(/  const UNPRESCRIBED_SCHEMA = \{[\s\S]*?\n  \};/)[0];
  vm.runInContext(schema+'\nthis.aiSchema=UNPRESCRIBED_SCHEMA;',c);
  assert.equal(c.aiSchema.properties.r.items.type,'object');
  assert.equal(c.aiSchema.properties.c.items.type,'object');
  assert.ok(c.aiSchema.properties.c.items.properties.kind.enum.includes('EMOCROMO'));
  assert.ok(!c.aiSchema.properties.c.items.properties.kind.enum.includes('CHIMICA CLINICA'));
  for (const [kind,text] of [['BILIRUBINA','BILIRUBINA TOTALE 0,8 mg/dL'],['PSA_REFLEX','PSA TOTALE 1,3 ng/mL']]) {
    const valid=c.validateUnprescribedAiSource({results:[],complex:[{kind,label:kind,text}],uncertain:[]},text);
    assert.equal(valid.complex.length,1,kind);
  }
});

test('non-prescribed FT3 maps the report spelling to the misspelled CVP name and preserves value/range', () => {
  const context = reportContext();
  const result = context.prepareUnprescribedNumericCandidate({ raw_label: 'P-FT3(Triiodotironina Lib.)',
    value: '4,60', unit: 'pmol/L', ref_min: '3,90', ref_max: '6,80', ref_unit: 'pmol/L' }, '01/01/2026');
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.item.catalogCode, '90.43.3_0');
  assert.equal(Number(result.item.value.replace(',', '.')), 4.6);
  assert.equal(Number(result.item.refMin.replace(',', '.')), 3.9);
  assert.equal(Number(result.item.refMax.replace(',', '.')), 6.8);
});

test('unit-only and numeric continuation fragments never become catalog tests', () => {
  const context = reportContext();
  for (const raw_label of ['mg/dL 66 - 100', '10.91 * mmol/L 2.50 - 7.50',
    '65.5 * mg/dL 15.0 - 45.0', 'mg/g Creat. Fisiologico: 0.00 - 30.00']) {
    const result = context.prepareUnprescribedNumericCandidate({ raw_label }, '01/01/2026');
    assert.equal(result.ignoredNonExam, true, raw_label);
  }
  assert.equal(context.isKnownResidualNonExamLabel('P-UREA'), false);
});

test('urinary creatinine uses the ACR assay only with nearby explicit ratio evidence', () => {
  const context = reportContext();
  const text = 'U-CREATININA\nU-CREATININA g/L 1.92 g/L\nRAPPORTO U-ALBUMINA/U-CREATININA 10.83 mg/g Creat.';
  const decision = context.buildUnprescribedDecisionContext(text);
  assert.equal(decision.urineCreatinineForAcr, true);
  const raw = { raw_label: 'u - CREATININA g/L', value: '1.92', unit: 'g/L' };
  const result = context.prepareUnprescribedNumericCandidate(raw, '01/01/2026', decision);
  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.item.catalogCode, '90.16.3_7');
  assert.equal(result.item.value, '1,92'); assert.equal(result.item.unit, 'g/L');
  assert.equal(context.prepareUnprescribedNumericCandidate(raw, '01/01/2026', {}).success, false);
  const distant = 'U-CREATININA\n' + 'altro esame\n'.repeat(8) + 'RAPPORTO U-ALBUMINA/U-CREATININA';
  assert.equal(context.buildUnprescribedDecisionContext(distant).urineCreatinineForAcr, false);
  const ratio = context.prepareUnprescribedNumericCandidate({ raw_label: 'RAPPORTO U-ALBUMINA/U-CREATININA', value: '10.83', unit: 'mg/g' }, '01/01/2026', decision);
  assert.equal(ratio.success, false); assert.match(ratio.uncertain.reason, /Rapporto albumina\/creatinina/);
  const extractedRatio = context.extractAcrResult(text, 'GENERIC');
  assert.equal(extractedRatio.value, '10.83'); assert.equal(extractedRatio.unit, 'mg/g');
});

test('numeric headers retain glucose and urea while their continuation warnings are suppressed', () => {
  const context = reportContext();
  load(['parseInlineSpecimenMeasurement', 'parseAnchoredMeasurementLine', 'parsePureBilateralRangeLine',
    'parseNearbyBilateralRange', 'extractSpecimenAnchoredResults'], {}, context);
  context.getLongReportKind = () => null; // This synthetic fixture contains numeric tests only.
  const text = 'P-GLUCOSIO\n4.95 mmol/L 3.70 - 5.60\n89 mg/dL 66 - 100\nP-UREA\n10.91 * mmol/L 2.50 - 7.50\n65.5 * mg/dL 15.0 - 45.0\nP-CREATININA\n116.03 * umol/L 64.00 - 104.00\n1.31 * mg/dL 0.72 - 1.18';
  const raw = context.extractSpecimenAnchoredResults(text);
  assert.equal(raw.length, 3);
  const prepared = raw.map(item => context.prepareUnprescribedNumericCandidate(item, '01/01/2026'));
  assert.ok(prepared.every(item => item.success), JSON.stringify(prepared));
  assert.deepEqual(Array.from(prepared, result => result.item.catalogCode), ['90.27.1_2', '90.44.1_6', '90.16.3_2']);
  const urea = prepared[1].item;
  assert.ok(Math.abs(Number(urea.value.replace(',', '.')) - 65.5) < 0.1);
  assert.equal(urea.unit, 'mg/dL'); assert.ok(urea.refMin && urea.refMax);
});

test('non-prescribed writer reports retry and catalog selection totals', async () => {
  const context = load(['writeNonPrescribedItems'], {
    writeNonPrescribedItem: async item => {
      item._catalogSelectionMs = 1200;
      return { success: true, retries: item.retryCount };
    },
  });
  const result = await context.writeNonPrescribedItems([{ retryCount: 0 }, { retryCount: 2 }]);
  assert.equal(result.stats.retries, 2); assert.equal(result.stats.retriedRows, 1);
  assert.equal(result.stats.catalogSelectionMs, 2400); assert.equal(result.completed.length, 2);
});

test('ACR is not converted into either serum creatinine or the urine creatinine assay', () => {
  const context = reportContext();
  for (const raw_label of ['Rapp. ALBUMINA-CREATININA', 'RAPPORTO ALBUMINA-CREATININA (ACR) URINE']) {
    const result = context.prepareUnprescribedNumericCandidate({ raw_label, value: '<30', unit: 'mg/g' }, '01/01/2026');
    assert.equal(result.success, false);
    assert.match(result.uncertain.reason, /Rapporto albumina\/creatinina/);
    assert.doesNotMatch(result.uncertain.reason, /Unità creatinina/);
  }
});

test('eGFR is reported as ancillary data, not an unknown catalog test', () => {
  const context = reportContext();
  const result = context.prepareUnprescribedNumericCandidate({ raw_label: 'eGFR (CKD-EPI)',
    value: '109', unit: "ml/m'/1.73mq" }, '01/01/2026');
  assert.equal(result.success, false);
  assert.match(result.uncertain.reason, /dato accessorio/);
});

test('AOU synthetic excerpt separates serum creatinine, eGFR, FT3 and urinary ACR', () => {
  const context = reportContext();
  // Synthetic clinical fixture only: no identifiers or full patient report.
  const text = `P-CREATININA 60 umol/L 45 - 84
eGFR (CKD-EPI) (velocita' di filtrazione glomerulare stimata)
P-CREATININA 60 umol/L 45 - 84
0,68 mg/dL
eGFR (CKD-EPI) 109 ml/m'/1.73mq > 90
Rapp. ALBUMINA-CREATININA <30 mg/g < 30
P-FT3(Triiodotironina Lib.) 4,60 pmol/L 3,90 - 6,80`;
  const raw = context.extractAouPadovaResults(text);
  const creatinine = raw.filter(item => /CREATININA/.test(item.exam));
  assert.ok(creatinine.length >= 2);
  assert.ok(creatinine.every(item => item.unit !== 'mg/g'));
  const prepared = creatinine.map(item => context.prepareUnprescribedNumericCandidate(item, '01/01/2026'));
  assert.ok(prepared.every(item => item.success), JSON.stringify(prepared));
  const result = context.dedupeUnprescribedNumeric(prepared.map(item => item.item), []);
  assert.equal(result.length, 1);
  assert.equal(result[0].value, '0,68');
  assert.equal(context.extractAcrResult(text, 'AOU_PADOVA').unit, 'mg/g');
});

test('AOU fecal calprotectin and serum antibodies resolve from their own rows', () => {
  const context = reportContext();
  const targets = ['CALPROTECTINA [FECI]', 'HELICOBACTER PYLORI ANTICORPI',
    'ANTICORPI ANTI CELLULE PARIETALI GASTRICHE (APCA)'];
  context.getAvailableExams = () => targets;
  context.getLongReportKind = () => '';
  load(['resolveExamName', 'chooseResolutionForModelResult',
    'normalizedUnitLoose', 'unitCompatibleWithConcept', 'estimateResolvedGridTargets'], {}, context);

  const raw = context.extractAouPadovaResults([
    'S-Ab Anti H.Pylori-IgG\t* 120,4\tEIU\t< 22',
    'S-Anticorpi Anti PARETE GASTRICA (ELISA)\t6,8\tKU/L\t< 11 KU/L',
    'CALPROTECTINA FECALE\t< 18,2\tug/g\tfino a 55,0'
  ].join('\n'));
  assert.deepEqual(Array.from(raw, item => [item.raw_label, item.value, item.unit]), [
    ['S-Ab Anti H.Pylori-IgG', '120,4', 'EIU'],
    ['S-Anticorpi Anti PARETE GASTRICA (ELISA)', '6,8', 'KU/L'],
    ['CALPROTECTINA FECALE', '<18,2', 'ug/g']
  ]);
  const resolve = (item, unit = item.unit) =>
    context.chooseResolutionForModelResult(item.exam, item.raw_label, unit).resolution;
  assert.deepEqual(Array.from(raw, item => resolve(item).exam), [targets[1], targets[2], targets[0]]);
  assert.deepEqual([...context.estimateResolvedGridTargets(raw)].sort(), [...targets].sort());
  assert.equal(resolve(raw[1], 'ng/L').reason, 'unit_mismatch');
  assert.equal(resolve(raw[2], 'mg/dL').reason, 'unit_mismatch');

  targets[1] = 'HELICOBACTER PYLORI ANTIGENE NELLE FECI RICERCA DIRETTA';
  const absent = resolve(raw[0]);
  assert.equal(absent.reason, 'known_not_in_grid');
  assert.equal(absent.catalogEntry.code, '90.84.8_4');
  assert.equal(context.getExamConcept('Ab Anti H.Pylori-IgM'), null);
});

test('a single real proposal is clicked before blur on the first filter', async () => {
  const { context, state, input, target } = selectionContext();
  assert.equal((await context.choosePrescriptionCatalogTarget(input, '90.27.1_2', target)).success, true);
  assert.equal(state.tabs, 0); assert.equal(state.clicks, 1); assert.equal(state.queries, 1);
});

test('multiple proposals require clicking the exact code, with no unnecessary Tab', async () => {
  const { context, state, input, target } = selectionContext({ multiple: true });
  assert.equal((await context.choosePrescriptionCatalogTarget(input, '90.27.1_2', target)).success, true);
  assert.equal(state.clicks, 1); assert.equal(state.tabs, 0);
});

test('if the clicked proposal requires Tab, commit it without rewriting the filter', async () => {
  const { context, state, input, target } = selectionContext({ clickCommits: false });
  assert.equal((await context.choosePrescriptionCatalogTarget(input, '90.27.1_2', target)).success, true);
  assert.equal(state.clicks, 1); assert.equal(state.tabs, 1); assert.equal(state.queries, 1);
});

test('typed code without any real visible proposal never commits', async () => {
  const { context, state, input, target } = selectionContext({ optionsVisible: false });
  assert.equal((await context.choosePrescriptionCatalogTarget(input, '90.27.1_2', target)).success, false);
  assert.equal(state.tabs, 0); assert.equal(state.clicks, 0);
});

test('delayed field acquisition is awaited without rewriting or clicking again', async () => {
  const { context, state, input, target } = selectionContext({ commitDelay: 8, tabCommits: false });
  assert.equal((await context.choosePrescriptionCatalogTarget(input, target.catalogCode, target)).success, true);
  assert.equal(state.queries, 1); assert.equal(state.clicks, 1); assert.equal(state.tabs, 0);
  assert.ok(state.events.some(e => e.step === 3 && e.fieldMatched && !e.fieldIsCode));
});

test('closing a popup with Tab while leaving the typed code is never a selection', async () => {
  const { context, state, input, target, form } = selectionContext({ clickCommits: false, tabCommits: false });
  form.exemption.focus = () => { state.popupVisible = false; };
  const result = await context.choosePrescriptionCatalogTarget(input, target.catalogCode, target);
  assert.equal(result.success, false);
  assert.equal(state.queries, 1);
  assert.ok(state.events.some(e => e.step === 4 && e.fieldIsCode && !e.success));
});

test('a remounted option is reacquired in the same search', async () => {
  const { context, state, input, target, option } = selectionContext({ clickCommits: false, tabCommits: false });
  const fresh = { textContent: option.textContent };
  context.getPrescriptionCatalogOptions = () => state.popupVisible ? [state.clicks ? fresh : option] : [];
  context.dispatchVaadinMouseSequence = selected => {
    state.clicks++;
    if (selected === fresh) { input.value = 'GLUCOSIO [S]'; state.popupVisible = false; }
  };
  assert.equal((await context.choosePrescriptionCatalogTarget(input, target.catalogCode, target)).success, true);
  assert.equal(state.queries, 1); assert.equal(state.clicks, 2);
  assert.ok(state.events.some(e => e.step === 5 && e.success));
});

test('duplicate exact proposals do not pick an arbitrary menu item', async () => {
  const { context, state, input, target, option } = selectionContext();
  context.getPrescriptionCatalogOptions = () => [option, {textContent: option.textContent}];
  assert.equal((await context.choosePrescriptionCatalogTarget(input, target.catalogCode, target)).success, false);
  assert.equal(state.clicks, 0); assert.equal(state.tabs, 0);
});

test('a code-filtered caption without a displayed code is selected on the first query', async () => {
  const {context,state,input,target,option} = selectionContext();
  option.textContent = 'GLUCOSIO [S]';
  assert.equal((await context.choosePrescriptionCatalogTarget(input,target.catalogCode,target)).success,true);
  assert.equal(state.queries,1);assert.equal(state.clicks,1);
  assert.ok(state.events.some(e=>e.step===2 && e.codeAbsentCount===1));
});

test('the exact caption wins over a partial name without selecting another displayed code', async () => {
  const {context,state,input,target,option} = selectionContext();
  option.textContent = 'GLUCOSIO [S]';
  const partial={textContent:'GLUCOSIO [S] dopo stimolo'};
  const conflict={textContent:'90.27.1_3 -- GLUCOSIO [S]'};
  context.getPrescriptionCatalogOptions=()=>state.popupVisible?[partial,option,conflict]:[];
  assert.equal((await context.choosePrescriptionCatalogTarget(input,target.catalogCode,target)).success,true);
  assert.equal(state.clicks,1);
  assert.ok(state.events.some(e=>e.step===2 && e.codeConflictCount===1 && e.matchingOptions===1));
});

test('a conflicting displayed code is rejected even if the caption matches', async () => {
  const {context,state,input,target,option} = selectionContext();
  option.textContent='90.27.1_3 -- GLUCOSIO [S]';
  assert.equal((await context.choosePrescriptionCatalogTarget(input,target.catalogCode,target)).success,false);
  assert.equal(state.clicks,0);
});

test('administrative reference codes do not block the actual suggestion or masquerade as its identifier',async()=>{
  const {context,state,input,target,option}=selectionContext();
  option.textContent='GLUCOSIO [S]. Non associabile a 90.27.1_3';
  assert.equal((await context.choosePrescriptionCatalogTarget(input,target.catalogCode,target)).success,true);
  assert.equal(state.queries,1);assert.equal(state.clicks,1);
  assert.ok(state.events.some(e=>e.step===2&&e.codeConflictCount===0&&e.ignoredReferenceCodesCount===1));
  const wrong=context.prescriptionCatalogOptionEvidence({textContent:'90.27.1_3 -- GLUCOSIO [S]. Non associabile a 90.27.1_2'},target);
  assert.equal(wrong.codeExact,false);assert.equal(wrong.codeConflict,true);assert.equal(wrong.score,0);
  assert.equal(context.prescriptionRowMatchesItem(row('90.27.1_3 OTHER. Non associabile a 90.27.1_2'),target),false);
});

test('non-prescribed protein code ignores an included-test reference in electrophoresis', () => {
  const wrong={textContent:'ELETTROFORESI delle PROTEINE SIERICHE (PROTIDOGRAMMA) Incluso: Dosaggio delle proteine totali 90.38.5_2'};
  const right={textContent:'90.38.5_2 -- PROTEINE [S]'};
  for(const option of [wrong,right]) option.closest=()=>null;
  const c=load(['normalizeExamName','significantTokens','sanitizeCreationCatalogAlias',
    'filterSelectCandidateScore','findVisibleFilterSelectOption'],{
    document:{querySelectorAll:()=>[wrong,right]},
    isActuallyVisibleInViewport:()=>true,
    isVisibleElement:()=>true
  });
  assert.equal(c.filterSelectCandidateScore(wrong.textContent,'90.38.5_2'),0);
  assert.equal(c.filterSelectCandidateScore(right.textContent,'90.38.5_2'),12000);
  assert.equal(c.findVisibleFilterSelectOption('90.38.5_2'),right);
  assert.ok(c.filterSelectCandidateScore('PROTEINE [S]','PROTEINE [S]')>0);
  const prepared=reportContext().prepareUnprescribedNumericCandidate({
    raw_label:'P-PROTEINE TOTALI',value:'70',unit:'g/L',ref_min:'64',ref_max:'83',ref_unit:'g/L'
  },'');
  assert.equal(prepared.success,true,JSON.stringify(prepared));
  assert.equal(prepared.item.catalogCode,'90.38.5_2');
});

test('the real HIV combined-test caption ignores its Immunoblotting exclusion code',()=>{
  const c=resolverContext();
  load(['normalizePrescriptionRowText','prescriptionRowText','sanitizeCreationCatalogAlias','prescriptionRowMatchesItem',
    'filterSelectCandidateScore','prescriptionCatalogOptionEvidence'],{},c);
  const entry=c.findCatalogEntryByCode('91.23.F_0');
  const full=entry.aliases.find(alias=>/Non associabile/.test(alias));
  const e=c.prescriptionCatalogOptionEvidence({textContent:full},{catalogCode:entry.code,exam:entry.name,catalogEntry:entry});
  assert.ok(e.score>=7000);assert.equal(e.codeConflict,false);assert.ok(e.ignoredReferenceCodesCount>=1);
});

test('a caption shortened by Eumed is recognized after clicking the verified exact code', async () => {
  const {context,state,input,target,option} = selectionContext();
  option.textContent='90.27.1_2 -- GLUCOSIO';
  context.dispatchVaadinMouseSequence=()=>{state.clicks++;input.value='GLUCOSIO';state.popupVisible=false;};
  assert.equal((await context.choosePrescriptionCatalogTarget(input,target.catalogCode,target)).success,true);
  assert.equal(state.queries,1);
});

test('prescription options ignore mounted offscreen popup entries', () => {
  const hidden = {}, visible = {};
  const context = load(['getPrescriptionCatalogOptions'], {
    document: { querySelectorAll: () => [hidden, visible, visible] },
    isActuallyVisibleInViewport: option => option === visible,
  });
  const options = context.getPrescriptionCatalogOptions();
  assert.equal(options.length, 1); assert.equal(options[0], visible);
});

test('PDF geometry reconstructs unordered columns without joining adjacent rows', () => {
  const c=load(['textContentToLines']);
  const item=(str,x,y,width=40)=>({str,width,transform:[1,0,0,10,x,y]});
  const result=c.textContentToLines({items:[item('mg/dl',250,100),item('HDL',10,100),item('AST',10,80),item('52',180,100),item('21',180,80),item('U/l',250,80)]});
  assert.equal(result,'HDL\t52\tmg/dl\nAST\t21\tU/l');
});

test('AI context preserves specimen following a tabular measurement without adjacent results', () => {
 const c=load(['normalizeExamName','buildTargetedReportContext'],{targetConceptTerms:()=>['CK'],getLongReportKind:()=>''});
 const result=c.buildTargetedReportContext('CK\t123\tU/l\nMetodo: enzimatico\nMateriale: SIERO\nCreatinina urinaria\t2\tg/l',['CK']);
 assert.match(result,/Materiale: SIERO/);assert.doesNotMatch(result,/Creatinina/);
});

test('bracketed specimens distinguish urinary creatinine used for ACR from the ratio', () => {
 const c=load(['normalizeExamName','detectSpecimen','specimenCompatible','getExamConcept']);
 assert.equal(c.detectSpecimen('CREATININA [U] per calcolo ACR'),'URINE');
 assert.equal(c.detectSpecimen('CREATININA [S] con eventuale eGFR'),'SERUM');
 assert.equal(c.getExamConcept('CREATININA [U] per calcolo ACR'),'CREATININE_URINE');
 assert.equal(c.getExamConcept('Creatinina Urinaria'),'CREATININE_URINE');
 assert.equal(c.getExamConcept('Rapporto albumina creatinina ACR'),'ACR');
 assert.equal(c.specimenCompatible('Creatinina Urinaria','CREATININA [U] per calcolo ACR'),true);
 assert.equal(c.specimenCompatible('Creatinina Urinaria','CREATININA [S]'),false);
 assert.equal(c.detectSpecimen('Creatinchinasi 123 U/l'),'');
});

test('signature timestamp before signature label is a report date, not birth or acceptance',()=>{
 const c=load(['isValidCalendarDateParts','normalizeDateValue','parseExplicitReportDateText']);
 assert.equal(c.parseExplicitReportDateText('Data nascita: 01/01/1960\nData Acc.: 10/11/2026\n12-11-2026 17.25\tSN=123 Referto firmato da: ESEMPIO').date,'2026-11-12');
 assert.equal(c.parseExplicitReportDateText('Data nascita: 01/01/1960\nData Acc.: 10/11/2026').date,'');
});
test('single explicit reference limits preserve the missing bound and reject multiple bands',()=>{
 const c=load(['parseBilateralRangeFromTail','shouldSuppressAutomaticRange','convertRange'],{PREFERRED_UNITS:{},unitsCompatible:()=>true,convertMeasurement:(_c,v,u)=>({ok:true,value:v,unit:u})});
 assert.equal(c.parseBilateralRangeFromTail('< 40').max,'40');
 assert.equal(c.parseBilateralRangeFromTail('< 40').min,'');
 assert.equal(c.parseBilateralRangeFromTail('> 55 Nessun rischio 35 - 55 Rischio moderato'),null);
 assert.equal(c.convertRange('AST','','40','U/L','U/L').max,'40');
 assert.equal(c.convertRange('AST','','40','U/L','U/L').min,'');
 assert.equal(c.convertRange('AST','','','U/L','U/L').available,false);
});


test('residual AI schema requests report date and exact date evidence',()=>{
 const c=load(['buildResidualResolverSchema']);const schema=c.buildResidualResolverSchema(['T1']);
 assert.equal(schema.properties.d.type,'string');assert.equal(schema.properties.de.type,'string');
 assert.ok(schema.required.includes('d'));assert.ok(schema.required.includes('de'));
});

test('ACR unit abbreviation crea is normalized without accepting serum creatinine ratios',()=>{
 const c=load(['normalizeUnit','normalizedUnitLoose','unitCompatibleWithConcept']);
 assert.equal(c.normalizeUnit('mg/g crea'),'mg/g');
 assert.equal(c.unitCompatibleWithConcept('ACR','mg/g crea'),true);
 assert.equal(c.unitCompatibleWithConcept('CREATININE','mg/g crea'),false);
});

test('recommendation lines are reference metadata, while real tests with thresholds remain candidates',()=>{
 const c=reportContext();
 for(const label of ['Raccomandato: < 190','Raccomandato: > 66','Raccomandato: Fino a 150']) assert.equal(c.isKnownResidualNonExamLabel(label),true);
 assert.equal(c.isKnownResidualNonExamLabel('P-COLESTEROLO TOTALE'),false);
 assert.equal(c.parseBilateralRangeFromTail('Raccomandato: < 190').max,'190');
 assert.equal(c.parseBilateralRangeFromTail('Raccomandato: > 66').min,'66');
 assert.equal(c.parseBilateralRangeFromTail('Raccomandato: Fino a 150').max,'150');
});
test('duplicate ACR warnings are reported once without mapping the ratio to creatinine',()=>{
 const c=reportContext();load(['dedupeUnprescribedWarnings'],{},c);
 const warnings=c.dedupeUnprescribedWarnings([{text:'Rapporto Alb/Cre (RAC) <25 mg/g Creat.',reason:'Catalogo non univoco'},{text:'Rapporto Alb/Cre (RAC)',reason:'Catalogo non univoco'},{text:'Raccomandato: < 180',reason:'Nessuna voce'}]);
 assert.equal(warnings.length,1);assert.match(warnings[0].text,/RAC/);
 assert.equal(c.preferredCreationCatalogDecision('Rapporto Alb/Cre (RAC)').blocked,true);
});
test('flagged IFCC glycated hemoglobin is parsed without requiring AI rescue',()=>{
 const c=reportContext();load(['isHbA1cLabel','isHbA1cAuxiliaryLine','extractHbA1cFallback'],{},c);
 const result=c.extractHbA1cFallback('EMOGLOBINA GLICATA\nB-HbA1C (IFCC)\t44 * mmol/mol\t20 - 42');
 assert.equal(result.value,'44');assert.equal(result.unit,'mmol/mol');
});

test('administrative headers and already parsed HbA1c do not trigger residual AI, unknown analytes still do',()=>{
 const c=inlineLabContext();load(['isHbA1cLabel','isHbA1cAuxiliaryLine'],{},c);
 const parsed={labLayout:'ULSS6_SCHIAVONIA',results:[{exam:'EMOGLOBINA GLICATA (HbA1c)',value:'44',unit:'mmol/mol'}],longReports:[]};
 const noise='Azienda ULSS n. 6 Euganea\nB-HbA1C (IFCC) 44 * mmol/mol\nRaccomandato: < 180\nIMPORTANTE: al fine di una corretta interpretazione consultare il Medico';
 assert.equal(c.getUnclaimedAiEvidence(noise,parsed).count,0);
 assert.equal(c.getUnclaimedAiEvidence(noise+'\nANALITA SCONOSCIUTO 12 mg/dL',parsed).count,1);
});

test('residual resolver uses named fields and one independent output contract',()=>{
 const c=load(['buildResidualResolverSchema','buildReferenceIntervalPrompt','buildResidualResolverSystemPrompt']);const schema=c.buildResidualResolverSchema(['T1']);
 assert.equal(schema.properties.r.items.type,'object');assert.equal(schema.properties.l.items.type,'object');
 assert.ok(schema.properties.r.items.required.includes('raw_label'));assert.ok(schema.properties.r.items.required.includes('value'));
 assert.equal(schema.properties.r.items.additionalProperties,false);assert.ok(c.buildResidualResolverSystemPrompt().length<3000);
});

test('phosphates, urinary daily excretion and bone ALP remain distinct',()=>{
 const c=reportContext();load(['getLongReportKind','parseInlineSpecimenMeasurement','parseAnchoredMeasurementLine','parsePureBilateralRangeLine','parseNearbyBilateralRange','extractSpecimenAnchoredResults'],{},c);
 const raw=c.extractSpecimenAnchoredResults('s - FOSFATI\nMetodo: test\n3,5 mg/dL 2,3 - 5,1\nu - CALCIO\n48 mg/24h 100 - 300\nu - FOSFATO\n0,50 g/24h 0,40 - 1,30\ns - FOSFATASI ALCALINA OSSEA SPECIFICA\n10 ug/L 4 - 26 Premenopausa\n5 - 24 Postmenopausa');
 assert.equal(raw.length,4);assert.equal(c.getExamConcept(raw[0].exam),'PHOSPHATE');assert.equal(c.getExamConcept(raw[1].exam),'CALCIUM_URINE');assert.equal(c.getExamConcept(raw[2].exam),'PHOSPHATE_URINE');assert.equal(c.getExamConcept(raw[3].exam),'ALP_BONE');
 assert.equal(raw[3].ref_min,'');assert.equal(c.getExamConcept('CALCIO TOTALE [U] 24H'),'CALCIUM_URINE');assert.equal(c.getExamConcept('FOSFATO INORGANICO [U] 24H'),'PHOSPHATE_URINE');assert.equal(c.getExamConcept('FOSFATASI ALCALINA ISOENZIMA OSSEO'),'ALP_BONE');
 assert.equal(c.convertMeasurement('PHOSPHATE_URINE','0,50','g/24h').unit,'g/24h');assert.equal(c.convertMeasurement('CALCIUM_URINE','48','mg/24h').value,'48');
});

test('long prescription lists are batched without losing entries, decimals or parenthesized names',()=>{
 const c=load(['splitPrescriptionAnalysisText']);const entries=Array.from({length:180},(_,i)=>'Esame sintetico '+i+' (metodo A, B)');
 const text=entries.join('\n');const chunks=c.splitPrescriptionAnalysisText(text);assert.ok(chunks.length>1);assert.equal(chunks.join('\n'),text);assert.ok(chunks.every(x=>x.length<=900));
 assert.equal(c.splitPrescriptionAnalysisText('Vitamina 1,25 OH; AST, ALT').join('\n'),'Vitamina 1,25 OH\nAST\nALT');
});
test('short comma-separated prescription list stays in one analysis batch',()=>{
 const c=load(['splitPrescriptionAnalysisText']);
 const labels=['emocromo','pcr','vitamina d','creatinina','got','gpt','glucosio','colesterolo totale','colesterolo hdl','trigliceridi','esame urine','ACTH','cortisolo','D-Dimero','sodio','potassio','elettroforesi proteica','catecolamine urinarie','catecolamine plasmatiche','Rx torace'];
 const chunks=c.splitPrescriptionAnalysisText(labels.join(', '));
 assert.equal(chunks.length,1);
 assert.equal(chunks[0].split('\n').length,labels.length);
});
test('reviewed prescription labels select routine CRP, morning ACTH, protein electrophoresis and catecholamine groups',()=>{
 const c=resolverContext();
 for(const [label,code] of [['pcr','90.72.3_2'],['ACTH','90.15.2_2'],['elettroforesi proteica','90.38.4_0'],['protidogramma','90.38.4_0'],['catecolamine urinarie','CATE'],['catecolamine plasmatiche','CATEPLA']]) {
   assert.equal(c.preferredPrescriptionCatalogEntry(label)?.code,code,label);
 }
 assert.equal(c.preferredPrescriptionCatalogEntry('HIV RNA previa PCR'),null);
 assert.equal(c.preferredPrescriptionCatalogEntry('ACTH test completo')?.code,'ACTH');
 const result=c.resolvePrescriptionListItems(['pcr','ACTH','elettroforesi proteica','catecolamine urinarie','catecolamine plasmatiche'].map(raw_label=>({raw_label})));
 assert.deepEqual(Array.from(result.resolved,item=>item.catalogCode),['90.72.3_2','90.15.2_2','90.38.4_0','CATE','CATEPLA']);
});
test('catecholamine group is confirmed by its new child row',()=>{
 const {state,context}=gridContext();
 const target={catalogCode:'CATEPLA',exam:'CATECOLAMINE PLASMATICHE',catalogEntry:{name:'CATECOLAMINE PLASMATICHE',aliases:[]}};
 const before=context.getPrescriptionWriteSnapshot(target);
 state.total='11';const added=row('90.03.6_4 ADRENALINA [P]');state.rows=[added];
 assert.equal(context.findNewPrescriptionRow(before,target),added);
 assert.equal(context.prescriptionRowMatchesItem(row('90.03.6_6 ADRENALINA [U]'),target),false);
});
test('incomplete prescription JSON retries smaller analysis batches and retains selective context',async()=>{
 let calls=0;const c=load(['splitPrescriptionAnalysisText','extractPrescriptionListWithQwenText'],{extractPrescriptionListTextBatch:async(text,_cb,selective)=>{calls++;assert.equal(selective,true);if(text.includes('\n'))throw Error('IA non ha restituito JSON completo.');return {items:[{raw_label:text}],uncertain:[]};}});
 const result=await c.extractPrescriptionListWithQwenText('[x] AST\n[ ] ALT\n[x] GGT');assert.equal(result.items.length,3);assert.ok(calls>3);
});

test('prescription components follow requested reflex policies and never schedule direct bilirubin',()=>{
 const c=resolverContext();const result=c.resolvePrescriptionListItems(['Bilirubina totale','Bilirubina diretta','Bilirubina indiretta','PSA totale','PSA libero',"Elettroforesi dell'emoglobina",'Emoglobina A2 (HbA2)','Emoglobina fetale (HbF)','Colesterolo LDL'].map(raw_label=>({raw_label})));
 assert.deepEqual(Array.from(result.resolved,x=>x.catalogCode),['90.10.5_3','90.56.9_0','90.66.7_2','90.13.C_0']);
 assert.equal(result.uncertain.length,2);assert.ok(result.uncertain.every(x=>/Saltata/.test(x.reason)));
 assert.equal(result.resolved.find(x=>x.catalogCode==='90.56.9_0').requestedLabels.length,2);
 assert.equal(result.resolved.find(x=>x.catalogCode==='90.66.7_2').requestedLabels.length,3);
});
test('reviewed prescription aliases distinguish antigen subtypes, fractions and routine tests from stimulated tests',()=>{
 const c=resolverContext();for(const [label,code] of [['Folati (acido folico)','90.23.2_2'],['Pepsinogeno I','90.38.M_0'],['Pepsinogeno II','90.38.N_0'],['Anticorpi anti-Jo-1','90.47.7_0'],['Anticorpi anti-Mi-2','90.52.5_40'],['Tireoglobulina','90.41.5_0'],['17-OH progesterone','90.01.2_0'],['Androstenedione','90.17.3_0'],['IgG4 sieriche','90.68.4_5'],['HBV-DNA quantitativo','91.16.B_0'],['HCV-RNA quantitativo','91.19.4_0']])assert.equal(c.preferredPrescriptionCatalogEntry(label).code,code,label);
 const explicit=c.preferredPrescriptionCatalogEntry('90.13.B_0 Colesterolo LDL indiretto');assert.equal(explicit.code,'90.13.B_0');
});

test('P0 selective lists require a mark on the same segment and exact label boundaries',()=>{
 const c=load(['normalizeExamName','prescriptionSelectionSupported']);
 const source='[x] AST   [ ] ALT\n[ ] PSA libero\n[x] PSA totale\n☑ GGT';
 for(const label of ['AST','PSA totale','GGT']) assert.equal(c.prescriptionSelectionSupported(label,source,true),true,label);
 for(const label of ['ALT','PSA libero','T totale']) assert.equal(c.prescriptionSelectionSupported(label,source,true),false,label);
 assert.equal(c.prescriptionSelectionSupported('ALT','AST\nALT',false),true);
 assert.equal(c.prescriptionSelectionSupported('ALT','[x] AST\nALT',true),false);
});
function evidenceContext(){return load(['normalizeExamName','normalizeUnit','parseBilateralRangeFromTail','sourceLabelForAiRow','validateAiMeasurementEvidence','isValidCalendarDateParts','normalizeDateValue','parseExplicitReportDateText','validatedAiReportDate']);}
test('P1 evidence binds numeric value and independent limits to one examination',()=>{
 const c=evidenceContext(), source='AST 15 U/L 0 - 40\nALT 14 U/L 0 - 50';
 const item={raw_label:'AST',value:'15',unit:'U/L',ref_min:'0',ref_max:'40',ref_unit:'U/L',line_start:1,line_end:1};
 const valid=c.validateAiMeasurementEvidence(item,source);assert.equal(valid.ref_max,'40');assert.equal(valid._sourceEvidence.quote,source.split('\n')[0]);assert.equal(Object.isFrozen(valid._sourceEvidence),true);
 assert.equal(c.validateAiMeasurementEvidence({...item,value:'14'},source),null);
 assert.equal(c.validateAiMeasurementEvidence({...item,line_end:2},source),null);
 const badRange=c.validateAiMeasurementEvidence({...item,ref_max:'50'},source);assert.equal(badRange.ref_max,'');assert.equal(badRange.value,'15');assert.equal(badRange._rangeRejected,true);
 assert.equal(c.validateAiMeasurementEvidence({...item,quote:'invented'},source),null);
 assert.equal(c.validateAiMeasurementEvidence({...item,line_start:undefined,line_end:undefined},source+'\nAST 15 U/L 0 - 40'),null);
});
test('P1 evidence supports numeric continuations, decimal commas and one-sided limits',()=>{
 const c=evidenceContext();
 const result=c.validateAiMeasurementEvidence({raw_label:'ALT',value:'14.5',unit:'U/L',ref_max:'40'},'ALT\n14,5\nU/L\n<40');
 assert.equal(result.value,'14.5');assert.equal(result.ref_max,'40');
 assert.equal(c.validateAiMeasurementEvidence({raw_label:'AST',value:'14',unit:'U/L'},'AST\nALT 14 U/L'),null);
});
test('AI evidence accepts a verified 24-hour unit and a flag before the value',()=>{
 const c=evidenceContext();
 const source='Fosfato Inorganico Urinario 24h\t1,0\tg/24h\t0,4 - 1,3\nCalcio Urinario 24h\t↑\t330\tmg/24h\t100 - 300';
 const phosphate=c.validateAiMeasurementEvidence({raw_label:'Fosfato Inorganico Urinario 24h',value:'1,0',unit:'g/24h',ref_min:'0,4',ref_max:'1,3',ref_unit:'g/24h',line_start:1,line_end:1},source);
 const calcium=c.validateAiMeasurementEvidence({raw_label:'Calcio Urinario 24h',value:'330',unit:'mg/24h',ref_min:'100',ref_max:'300',ref_unit:'mg/24h',line_start:2,line_end:2},source);
 assert.equal(phosphate?.unit,'g/24h');assert.equal(calcium?.value,'330');
 assert.equal(c.validateAiMeasurementEvidence({raw_label:'Calcio Urinario 24h',value:'300',unit:'mg/24h',line_start:2,line_end:2},source),null);
});
test('P1 dates normalize format but require the same explicit report date in source',()=>{
 const c=evidenceContext(),source='Data referto: 13/11/2026\nData nascita: 10/10/1980';
 assert.equal(c.validatedAiReportDate('13/11/2026','Data referto: 13/11/2026',source),'2026-11-13');
 assert.equal(c.validatedAiReportDate('2026-11-14','Data referto: 13/11/2026',source),'');
 assert.equal(c.validatedAiReportDate('1980-10-10','Data nascita: 10/10/1980',source),'');
 assert.equal(c.validatedAiReportDate('2026-11-13','Data referto: 13/11/2026','other'),'');
});
test('P1 microalbumin concentration is accepted without treating a ratio as concentration',()=>{
 const c=load(['normalizeExamName','normalizeUnit','normalizedUnitLoose','unitCompatibleWithConcept','detectSpecimen']);
 assert.equal(c.unitCompatibleWithConcept('ACR','mg/L','Microalbuminuria'),true);
 assert.equal(c.unitCompatibleWithConcept('ACR','mg/L','Rapporto albumina creatinina'),false);
 assert.equal(c.unitCompatibleWithConcept('CREATININE','mg/g','Creatinina [S]'),false);
 assert.equal(c.detectSpecimen('Microalbuminuria per calcolo ACR'),'URINE');
});

test('P0 visual prescriptions reject candidates not confirmed by an independent image pass',async()=>{
 let calls=0;const c=load(['normalizeExamName','expandPrescriptionListPayload','extractJSONObject','extractPrescriptionListWithQwenVision'],{ollamaChat:async messages=>{
 assert.equal(messages[0].images[0],'synthetic-image');calls++;
 return calls===1?JSON.stringify({i:[['AST','X'],['ALT','X']],u:[]}):JSON.stringify({rows:[{index:0,label:'AST',selected:true,marker:'checked'},{index:1,label:'ALT',selected:false,marker:'empty'}]});
 }});vm.runInContext(source.match(/  const PRESCRIPTION_LIST_SCHEMA = \{[\s\S]*?\n  \};/)[0],c);
 const result=await c.extractPrescriptionListWithQwenVision('synthetic-image','synthetic');
 assert.equal(calls,2);assert.deepEqual(Array.from(result.items,x=>x.raw_label),['AST']);assert.equal(result.uncertain[0].text,'ALT');
});
test('P1 rejected range cannot reappear through evidence fallback',()=>{
 const c=load(['prepareRangeInput']);assert.equal(c.prepareRangeInput({_rangeRejected:true,evidence:'AST 15 U/L 0 - 40'},'U/L').max,'');
});

test('P1 model-renamed label is recovered only from a matching source measurement',()=>{
 const c=evidenceContext();
 const x=c.validateAiMeasurementEvidence({raw_label:'ASPARTATO AMINOTRANSFERASI',value:'15',unit:'U/L',line_start:1,line_end:1},'AST 15 U/L 0 - 40');
 assert.equal(x.raw_label,'AST');assert.equal(x._sourceEvidence.quote,'AST 15 U/L 0 - 40');
 assert.equal(c.validateAiMeasurementEvidence({raw_label:'ASPARTATO AMINOTRANSFERASI',value:'16',unit:'U/L',line_start:1,line_end:1},'AST 15 U/L 0 - 40'),null);
});
test('P1 ranges from another inline examination or multiple bands are not reused',()=>{
 const c=evidenceContext();
 for(const tail of ['ALT 14 U/L 0 - 50','0 - 50; 0 - 60']){
 const x=c.validateAiMeasurementEvidence({raw_label:'AST',value:'15',unit:'U/L',ref_min:'0',ref_max:'50'},'AST 15 U/L '+tail);
 assert.equal(x._rangeRejected,true);assert.equal(x.ref_max,'');
 }
});

test('urinary creatinine preferred codes exist in the catalog and are unrelated to the software version',()=>{
 const c=resolverContext();
 assert.equal(c.preferredCreationCatalogDecision('CREATININA [U] per calcolo ACR').entry.code,'90.16.3_7');
 assert.equal(c.preferredCreationCatalogDecision('CREATININA [U] 24H').entry.code,'90.16.3_3');
});

test('P1 albumin concentration cannot populate a pure ratio target',()=>{
 const c=load(['normalizeUnit','normalizedUnitLoose','unitCompatibleWithConcept']);
 assert.equal(c.unitCompatibleWithConcept('ACR','mg/L','Microalbuminuria','RAPPORTO ALBUMINA CREATININA'),false);
 assert.equal(c.unitCompatibleWithConcept('ACR','mg/L','Microalbuminuria','MICROALBUMINURIA per calcolo ACR'),true);
});

test('P1 date citations may retain a verified synthetic line prefix but never point to a different line',()=>{
 const c=evidenceContext(),source='AST 15 U/L\nData referto: 13/11/2026';
 assert.equal(c.validatedAiReportDate('2026-11-13','[L2] Data referto: 13/11/2026',source),'2026-11-13');
 assert.equal(c.validatedAiReportDate('2026-11-13','[L1] Data referto: 13/11/2026',source),'');
});

 test('both AI workflows share the same numeric interval contract',()=>{
 const c=load(['buildReferenceIntervalPrompt','buildResidualResolverSystemPrompt']);
 const contract=c.buildReferenceIntervalPrompt();assert.ok(c.buildResidualResolverSystemPrompt().includes(contract));
 const unprescribed=source.slice(source.indexOf('  async function extractUnprescribedWithQwen'),source.indexOf('  function isKnownResidualNonExamLabel'));
 assert.ok(unprescribed.includes('${buildReferenceIntervalPrompt()}'));assert.ok(!unprescribed.includes('un range bilaterale chiaro'));
 });
 test('single reference thresholds keep only their supported bound',()=>{
 const c=evidenceContext();
 for(const [tail,min,max] of [['<200','','200'],['<=200','','200'],['≤200','','200'],['>40','40',''],['>=40','40',''],['≥40','40','']]){
 const x=c.validateAiMeasurementEvidence({raw_label:'HDL',value:'53',unit:'mg/dL',ref_min:min,ref_max:max,ref_unit:'mg/dL'},'HDL 53 mg/dL '+tail);
 assert.ok(x);assert.equal(x._rangeRejected,false,tail);assert.equal(x.ref_min,min);assert.equal(x.ref_max,max);
 }
 });
