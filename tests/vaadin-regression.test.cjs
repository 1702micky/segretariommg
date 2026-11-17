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
const row = (text, index = '1') => ({ textContent: text, getAttribute: () => index });
function gridContext() {
  const state = { total: '10', rows: [] };
  const grid = {
    querySelector: () => ({ getAttribute: () => state.total }),
    querySelectorAll: () => state.rows,
  };
  const context = load(['normalizeExamName', 'prescriptionRowText', 'normalizePrescriptionRowText', 'getPrescriptionListRowCount',
    'prescriptionRowMatchesItem', 'getPrescriptionRowEvidence',
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
  assert.match(result.field, /già visibile/);
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
    'prescriptionRowMatchesItem', 'getPrescriptionRowEvidence', 'getPrescriptionWriteSnapshot',
    'findNewPrescriptionRow', 'waitForPrescriptionRowAdded',
    'waitForPrescriptionListForm', 'writePrescriptionListItemAttempt', 'writePrescriptionListItem'], {
    getPrescriptionListGrid: () => ({
      querySelector: () => ({ getAttribute: () => state.total }),
      querySelectorAll: () => state.rows,
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
  const context = load(['normalizeExamName', 'preferredPrescriptionCatalogEntry'], {
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
    'stripSpecimenPrefix', 'catalogScore', 'findCatalogEntryByCode', 'catalogEntrySpecimen',
    'sanitizeCreationCatalogAlias', 'serologyFamilyState', 'preferredCreationCatalogDecision',
    'creationCatalogScore', 'matchCatalogForCreation', 'buildUnprescribedDecisionContext',
    'buildPrescriptionDecisionContext', 'isMolecularMicrobiologyText',
    'directCatalogCodeFromPrescriptionLabel', 'preferredPrescriptionCatalogEntry', 'resolvePrescriptionListItems'],
    { labCatalog: catalog });
  const aliases = source.match(/  const CATALOG_QUERY_ALIASES = \{[\s\S]*?\n  \};/)[0];
  vm.runInContext(aliases, context);
  return context;
}

test('the complete reported list resolves through the real resolver and real catalog', () => {
  const context = resolverContext();
  const labels = ['tsh', 'emocromo', 'glicemia', 'glicata', 'ast', 'alanina amino transferasi', 'vitamina D'];
  const result = context.resolvePrescriptionListItems(labels.map(raw_label => ({ raw_label })));
  assert.equal(result.uncertain.length, 0);
  assert.deepEqual(Array.from(result.resolved, entry => entry.catalogCode),
    ['90.41.8_0', '90.62.2_2', '90.27.1_2', '90.28.1_0', '90.09.2_0', '90.04.5_0', '90.44.6_2']);
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

function selectionContext({ multiple = false, tabCommits = true, optionsVisible = true } = {}) {
  const state = { tabs: 0, clicks: 0, popupVisible: optionsVisible };
  const target = { catalogCode: '90.27.1_2', exam: 'GLUCOSIO [S]', catalogEntry: { name: 'GLUCOSIO [S]', aliases: [] } };
  const input = { value: '90.27.1_2', focus() {} };
  const popup = {};
  const option = { textContent: '90.27.1_2 -- GLUCOSIO [S]' };
  const form = { accertamento: input, exemption: { focus() {} } };
  const context = load(['normalizeExamName', 'significantTokens', 'filterSelectCandidateScore',
    'prescriptionRowText', 'normalizePrescriptionRowText', 'prescriptionRowMatchesItem',
    'choosePrescriptionCatalogTarget'], {
    triggerNonPrescribedCatalogFilter: async () => true,
    getPrescriptionCatalogOptions: () => state.popupVisible ? (multiple ? [
      { textContent: '90.27.1_3 -- GLUCOSIO [U] 24H' }, option,
    ] : [option]) : [],
    getFilterSelectPopup: () => popup,
    getPrescriptionListForm: () => form,
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
      state.clicks++; input.value = 'GLUCOSIO [S]'; state.popupVisible = false;
    },
  });
  return { context, state, input, target };
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
  load(['extractSimpleTransaminaseReport'], {}, context);
  const raw = context.extractSimpleTransaminaseReport('AST 17 U/L\nALT 19 U/L');
  const prepared = Array.from(raw, row => context.prepareUnprescribedNumericCandidate(row, ''));
  assert.equal(prepared.every(x => x.success), true, JSON.stringify(prepared));
  assert.deepEqual(prepared.map(x => x.item.catalogCode), ['90.09.2_0', '90.04.5_0']);
  assert.deepEqual(prepared.map(x => Number(x.item.value)), [17, 19]);
  assert.equal(raw.every(x => x.ref_min === '' && x.ref_max === ''), true);
  assert.equal(context.extractSimpleTransaminaseReport('got 17,5 UI/L\ngpt 19 U/L').length, 2);
  for (const text of ['', 'AST 17', 'ALT 19 mg/dL', 'AST 17 U/L\naltro esame 12', 'AST 17 U/L precedente 15', 'AST 10 - 40 U/L']) {
    assert.equal(context.extractSimpleTransaminaseReport(text), null);
  }
  Object.assign(context, {
    ensureLabCatalog: async () => {}, detectKnownLabLayout: () => null,
    parseExplicitReportDateText: () => null,
    extractUnprescribedWithQwen: () => { throw new Error('AI must not run for fully parsed plain lines'); },
    buildUnprescribedFixedComplexItems: () => [], buildRawSerologyComplexItems: () => [],
    detectSerologyComplexItems: () => ({ items: [], unmatched: [] }),
    rawResultCoveredByUnprescribedComplex: () => false,
  });
  load(['extractUnprescribedDeterministicRaw', 'extractUnprescribedFromReport'], {}, context);
  const result = await context.extractUnprescribedFromReport('AST 17 U/L\nALT 19 U/L');
  assert.equal(result.numeric.length, 2);
  assert.equal(result.stats.qwenUsed, false);
  assert.equal(result.uncertain.length, 1); // Missing report date remains visible.
  assert.equal(result.uncertain[0].text, 'Data del referto');
});

function reportContext() {
  const context = resolverContext();
  load(['cleanModelLabLabel', 'isSerologyCatalogEntry', 'looksLikeSerologyText',
    'normalizeValueString', 'parseItalianNumber', 'formatNumber', 'normalizeUnit', 'convertMeasurement',
    'parseBilateralRangeText', 'prepareRangeInput', 'shouldSuppressAutomaticRange', 'convertRange', 'unitsCompatible', 'sanitizeUnprescribedRange',
    'isKnownResidualNonExamLabel', 'prepareUnprescribedNumericCandidate', 'sameNumericValue', 'valuesClinicallyEquivalent', 'dedupeUnprescribedNumeric',
    'cleanReportLines', 'normalizeAouNumericToken', 'isNumericOrComparatorToken', 'isAouUnitToken',
    'isAouMajorLabel', 'parseAouBilateralRange', 'parseBilateralRangeFromTail',
    'parseInlineKnownMeasurement', 'parseAouContinuationMeasurement', 'extractAouPadovaResults',
    'extractAcrResult'], {}, context);
  vm.runInContext(source.match(/  const PREFERRED_UNITS = \{[\s\S]*?\n  \};/)[0], context);
  return context;
}

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

test('a single real proposal is committed with Tab on the first filter, without a click retry', async () => {
  const { context, state, input, target } = selectionContext();
  assert.equal((await context.choosePrescriptionCatalogTarget(input, '90.27.1_2', target)).success, true);
  assert.equal(state.tabs, 1); assert.equal(state.clicks, 0);
});

test('multiple proposals require clicking the exact code before Tab', async () => {
  const { context, state, input, target } = selectionContext({ multiple: true });
  assert.equal((await context.choosePrescriptionCatalogTarget(input, '90.27.1_2', target)).success, true);
  assert.equal(state.clicks, 1); assert.equal(state.tabs, 1);
});

test('if Tab alone fails, the exact proposal is clicked in the same search', async () => {
  const { context, state, input, target } = selectionContext({ tabCommits: false });
  assert.equal((await context.choosePrescriptionCatalogTarget(input, '90.27.1_2', target)).success, true);
  assert.equal(state.clicks, 1); assert.equal(state.tabs, 2);
});

test('typed code without any real visible proposal never commits', async () => {
  const { context, state, input, target } = selectionContext({ optionsVisible: false });
  assert.equal((await context.choosePrescriptionCatalogTarget(input, '90.27.1_2', target)).success, false);
  assert.equal(state.tabs, 0); assert.equal(state.clicks, 0);
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
