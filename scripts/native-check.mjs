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
  'checkLayout', 'createProposal', 'findPlacements', 'generateRoom', 'getRoomState', 'listCatalogue',
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

  await page.waitForFunction(async () => (await document.modelContext.getTools()).length >= 15, null, { timeout: 20000 })
    .catch(() => {});

  const result = await page.evaluate(async (expected) => {
    const mc = document.modelContext;
    const tools = await mc.getTools();
    const byName = new Map(tools.map(t => [t.name, t]));
    // The native contract: a RegisteredTool plus a JSON STRING, returning a JSON string.
    const call = async (name, args) => JSON.parse(await mc.executeTool(byName.get(name), JSON.stringify(args)));

    const missing = expected.filter(n => !byName.has(n));
    const room = await call('getRoomState', { which: 'current' });
    // Exercise the product's primary agent path, not just the older draft flow.
    const generated = await call('generateRoom', {
      name: 'Native-check L room', widthCm: 500, depthCm: 500,
      floorPlan: { kind: 'rectilinear', points: [
        { xCm: 0, yCm: 0 }, { xCm: 500, yCm: 0 }, { xCm: 500, yCm: 300 },
        { xCm: 300, yCm: 300 }, { xCm: 300, yCm: 500 }, { xCm: 0, yCm: 500 },
      ] },
      profile: { kind: 'lounge' },
      openings: [{ id: 'entrance', kind: 'door', wall: 'south', segmentId: 'wall-5', offsetCm: 20, widthCm: 100, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: true }],
      idempotencyKey: 'native-generate-' + Date.now(),
    });
    const draft = { proposalId: generated.proposalId, revision: generated.revision };
    const generatedRoom = await call('getRoomState', { which: 'proposal' });
    const checked = await call('checkLayout', { which: 'proposal', detail: 'issues' });
    const stale = await call('setAppearance', { proposalId: draft.proposalId, revision: 1, target: 'wall', paletteId: 'warm' });
    const humanOnlyAbsent = ['applyProposal', 'confirmSetup', 'discardProposal', 'humanSetLocks'].every(name => !byName.has(name));

    return {
      toolCount: tools.length, missing,
      annotated: tools.filter(t => t.annotations && 'readOnlyHint' in t.annotations).length,
      readSucceeded: room.operationSucceeded, generatedSucceeded: generated.operationSucceeded,
      plannedStatus: generated.status, plannedBlocking: generated.validation?.hardFailures,
      checkedStatus: checked.validation?.status, checkedBlocking: checked.validation?.hardFailures, brief: checked.brief?.status,
      staleCode: stale.error?.code, staleRefused: stale.operationSucceeded === false,
      humanOnlyAbsent, review: generated.review,
      customPointCount: generatedRoom.room?.floorPlan?.points?.length,
      customSegmentCount: generatedRoom.wallSegments?.length,
    };
  }, EXPECTED_TOOLS);

  check(`all ${EXPECTED_TOOLS.length} tools registered`, result.missing.length === 0,
    result.missing.length ? 'missing: ' + result.missing.join(', ') : `${result.toolCount} discovered`);
  check('every tool carries annotations', result.annotated === result.toolCount, `${result.annotated}/${result.toolCount}`);
  check('getRoomState reads Current', result.readSucceeded);
  check('generateRoom opens a human-review proposal', result.generatedSucceeded && result.review?.requiresHumanApply === true && result.review?.applied === false);
  check('custom outline returns six authoritative wall segments', result.customPointCount === 6 && result.customSegmentCount === 6,
    `points=${result.customPointCount}, segments=${result.customSegmentCount}`);
  check('generated proposal reaches ready_for_review', result.plannedStatus === 'ready_for_review', `status=${result.plannedStatus}`);
  check('generated layout has no hard failures', result.plannedBlocking === 0, `blocking=${result.plannedBlocking}`);
  // Soft warnings are expected and fine here: the L-shape exercises wall-backed
  // placement against several derived segments. What must hold is that the draft is not blocked and that
  // checkLayout and generateRoom report the same shared engine verdict.
  check('checkLayout agrees the draft is applicable', result.checkedStatus !== 'blocked' && result.checkedBlocking === result.plannedBlocking,
    `status=${result.checkedStatus}, blocking=${result.checkedBlocking} vs generateRoom ${result.plannedBlocking}`);
  check('required brief is satisfied', result.brief === 'satisfied', `brief=${result.brief}`);
  check('stale revision is refused', result.staleRefused && result.staleCode === 'revision_conflict', `code=${result.staleCode}`);
  check('human-only Apply and room confirmation are not tools', result.humanOnlyAbsent);
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed\n` : '\nall native checks passed\n');
process.exit(failures.length ? 1 : 0);
