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
  'checkLayout', 'createCustomFurniture', 'createProposal', 'findPlacements', 'generateRoom', 'getRoomState', 'listCatalogue',
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

  await page.waitForFunction(async () => (await document.modelContext.getTools()).length >= 16, null, { timeout: 20000 })
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
      name: 'Native-check sectional room', widthCm: 800, depthCm: 700,
      floorPlan: { kind: 'rectilinear', points: [
        { xCm: 0, yCm: 0 }, { xCm: 800, yCm: 0 }, { xCm: 800, yCm: 500 },
        { xCm: 600, yCm: 500 }, { xCm: 600, yCm: 700 }, { xCm: 0, yCm: 700 },
      ] },
      profile: { kind: 'home_office', seating: false, storage: false },
      openings: [
        { id: 'entrance', kind: 'door', wall: 'south', segmentId: 'wall-5', offsetCm: 20, widthCm: 100, hinge: 'start', swing: 'in', angle: 90, mechanism: 'hinged', entrance: true },
        { id: 'native-window', kind: 'window', wall: 'north', segmentId: 'wall-1', offsetCm: 160, widthCm: 120, sillCm: 90, headCm: 220, type: 'fixed', windowAccess: false },
      ],
      idempotencyKey: 'native-generate-' + Date.now(),
    });
    const draft = { proposalId: generated.proposalId, revision: generated.revision };
    const blind = await call('placeFurniture', {
      ...draft, variantId: 'line-blind-160', attachedOpeningId: 'native-window',
      idempotencyKey: 'native-blind-' + Date.now(),
    });
    draft.revision = blind.revision;
    const ceiling = await call('placeFurniture', {
      ...draft, variantId: 'dot-recessed-12', originCell: { x: 5, y: 5 }, lightingZone: 'ambient',
      idempotencyKey: 'native-ceiling-' + Date.now(),
    });
    draft.revision = ceiling.revision;
    const custom = await call('createCustomFurniture', {
      ...draft, label: 'Native U sectional', kind: 'sofa', widthCm: 400, depthCm: 240, heightCm: 85,
      positionCm: { xCm: 140, yCm: 20 }, rotation: 0, appearance: 'clay',
      geometry: { type: 'sectional', primaryFacing: 'south', modules: [
        { id: 'left-return', type: 'chaise', xCm: 0, yCm: 0, widthCm: 80, depthCm: 240, heightCm: 85, facing: 'east' },
        { id: 'centre', type: 'seat', xCm: 80, yCm: 0, widthCm: 240, depthCm: 80, heightCm: 85, facing: 'south' },
        { id: 'right-return', type: 'chaise', xCm: 320, yCm: 0, widthCm: 80, depthCm: 240, heightCm: 85, facing: 'west' },
      ] },
      idempotencyKey: 'native-custom-' + Date.now(),
    });
    draft.revision = custom.revision;
    const generatedRoom = await call('getRoomState', { which: 'proposal' });
    const fixtures = await call('listFurniture', { which: 'proposal' });
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
      blindSucceeded: blind.operationSucceeded,
      ceilingSucceeded: ceiling.operationSucceeded,
      customSucceeded: custom.operationSucceeded,
      customReview: custom.review,
      blindLinked: fixtures.furniture?.some(item => item.fixtureType === 'blind' && item.attachedOpeningId === 'native-window'),
      ceilingMounted: fixtures.furniture?.some(item => item.fixtureType === 'recessed' && item.kind === 'ceiling_light'),
      customMeasured: fixtures.furniture?.some(item => item.ownership === 'custom' && item.label === 'Native U sectional' && item.sizeCm?.w === 400 && item.sizeCm?.d === 240 && item.sizeCm?.h === 85 && item.customProvenance?.tool === 'createCustomFurniture' && item.geometry?.type === 'sectional' && item.geometry?.modules?.length === 3
        && item.geometry.modules[0].xCm + item.geometry.modules[0].widthCm === item.geometry.modules[1].xCm
        && item.geometry.modules[1].xCm + item.geometry.modules[1].widthCm === item.geometry.modules[2].xCm),
    };
  }, EXPECTED_TOOLS);

  check(`all ${EXPECTED_TOOLS.length} tools registered`, result.missing.length === 0,
    result.missing.length ? 'missing: ' + result.missing.join(', ') : `${result.toolCount} discovered`);
  check('every tool carries annotations', result.annotated === result.toolCount, `${result.annotated}/${result.toolCount}`);
  check('getRoomState reads Current', result.readSucceeded);
  check('generateRoom opens a human-review proposal', result.generatedSucceeded && result.review?.requiresHumanApply === true && result.review?.applied === false);
  check('custom outline returns six authoritative wall segments', result.customPointCount === 6 && result.customSegmentCount === 6,
    `points=${result.customPointCount}, segments=${result.customSegmentCount}`);
  check('native blind attaches to its measured window', result.blindSucceeded && result.blindLinked);
  check('native recessed light mounts inside the custom ceiling', result.ceilingSucceeded && result.ceilingMounted);
  check('native custom furniture preserves its measured envelope and proposal-only provenance', result.customSucceeded && result.customMeasured && result.customReview?.requiresHumanApply === true && result.customReview?.applied === false);
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
