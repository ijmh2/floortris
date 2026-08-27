// Native WebMCP acceptance check.
//
// Unlike the unit tests in components/floortris, this drives a REAL browser
// against a REAL origin and calls the tools through document.modelContext.
// It is the only check that exercises the actual WebMCP transport rather than
// the command store directly.
//
//   node scripts/native-check.mjs                        # localhost:3001
//   node scripts/native-check.mjs https://your.workers.dev
//
// Chrome only exposes document.modelContext behind a flag, so the flags below
// are mandatory. Without them the API is absent and this check reports that
// honestly rather than pretending the page is broken.

const URL_UNDER_TEST = process.argv[2] || process.env.FLOORTRIS_URL || 'http://localhost:3001/';
const FLAGS = [
  '--enable-features=WebMCP,WebMachineLearningModelContext',
  '--enable-blink-features=WebMCP',
];
const EXPECTED_TOOLS = [
  'checkLayout', 'createProposal', 'findPlacements', 'getRoomState', 'listCatalogue',
  'listFurniture', 'placeFurniture', 'proposeLayout', 'removeFurniture', 'setAppearance',
  'setConstraints', 'setOpening', 'setRoomGeometry', 'updateFurniture',
];

let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('native-check needs playwright-core: npm i -D playwright-core'); process.exit(2); }

const failures = [];
const check = (label, pass, detail = '') => {
  console.log(`${pass ? '  ok  ' : ' FAIL '} ${label}${detail ? ' — ' + detail : ''}`);
  if (!pass) failures.push(label);
};

console.log(`\nnative-check against ${URL_UNDER_TEST}\n`);
const browser = await chromium.launch({ channel: 'chrome', args: FLAGS });
try {
  const page = await browser.newPage();
  await page.goto(URL_UNDER_TEST, { waitUntil: 'networkidle', timeout: 45000 });

  const hasApi = await page.evaluate(() => typeof document.modelContext?.registerTool === 'function');
  check('document.modelContext is exposed', hasApi, hasApi ? '' : 'is Chrome running with the WebMCP flags?');
  if (!hasApi) process.exit(1);

  await page.waitForFunction(async () => (await document.modelContext.getTools()).length >= 14, null, { timeout: 20000 })
    .catch(() => {});

  const result = await page.evaluate(async (expected) => {
    const mc = document.modelContext;
    const tools = await mc.getTools();
    const byName = new Map(tools.map(t => [t.name, t]));
    // The native contract: a RegisteredTool plus a JSON STRING, returning a JSON string.
    const call = async (name, args) => JSON.parse(await mc.executeTool(byName.get(name), JSON.stringify(args)));

    const missing = expected.filter(n => !byName.has(n));
    const room = await call('getRoomState', { which: 'current' });
    const draft = await call('createProposal', {
      kind: 'layout',
      expectedCurrentRevision: room.currentRevision,
      expectedRuleRevision: room.ruleRevision,
      idempotencyKey: 'native-check-' + Date.now(),
    });
    const planned = await call('proposeLayout', { proposalId: draft.proposalId, revision: draft.revision });
    const checked = await call('checkLayout', { which: 'proposal', detail: 'issues' });
    const stale = await call('updateFurniture', { proposalId: draft.proposalId, revision: 1, objectId: 'owned-sofa', rotation: 90 });
    const sofa = (await call('listFurniture', { which: 'proposal' })).furniture?.find(f => f.id === 'owned-sofa');

    return {
      toolCount: tools.length, missing,
      annotated: tools.filter(t => t.annotations && 'readOnlyHint' in t.annotations).length,
      readSucceeded: room.operationSucceeded, draftSucceeded: draft.operationSucceeded,
      plannedStatus: planned.status, plannedBlocking: planned.validation?.hardFailures,
      checkedStatus: checked.validation?.status, brief: checked.brief?.status,
      staleCode: stale.error?.code, staleRefused: stale.operationSucceeded === false,
      sofaLocked: !!sofa?.locked?.position,
    };
  }, EXPECTED_TOOLS);

  check(`all ${EXPECTED_TOOLS.length} tools registered`, result.missing.length === 0,
    result.missing.length ? 'missing: ' + result.missing.join(', ') : `${result.toolCount} discovered`);
  check('every tool carries annotations', result.annotated === result.toolCount, `${result.annotated}/${result.toolCount}`);
  check('getRoomState reads Current', result.readSucceeded);
  check('createProposal opens a draft', result.draftSucceeded);
  check('proposeLayout reaches ready_for_review', result.plannedStatus === 'ready_for_review', `status=${result.plannedStatus}`);
  check('planned layout has no hard failures', result.plannedBlocking === 0, `blocking=${result.plannedBlocking}`);
  check('checkLayout agrees the draft is ok', result.checkedStatus === 'ok', `status=${result.checkedStatus}`);
  check('required brief is satisfied', result.brief === 'satisfied', `brief=${result.brief}`);
  check('stale revision is refused', result.staleRefused && result.staleCode === 'revision_conflict', `code=${result.staleCode}`);
  check('owned sofa stayed locked', result.sofaLocked);
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed\n` : '\nall native checks passed\n');
process.exit(failures.length ? 1 : 0);
