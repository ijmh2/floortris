# Floortris V1

A working room planner people and agents share. The page owns the rule engine; native WebMCP tools edit a visible proposal, and the human controls Apply and room-input confirmation.

## Run locally

Use Node 22.13+ and npm. From this directory:

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

Open the local URL printed by the development server. The app uses React, TypeScript and the Sites/vinext runtime. Runtime room data stays in the browser; there is no LLM service, furniture-commerce API, or remote room database. Fonts use a Google Fonts CSS import with local fallbacks.

## Live demo and how to test it

**https://floortris.floortris.workers.dev**

WebMCP is behind a flag in Chrome today. Without it `document.modelContext` does
not exist, the page says so plainly, and every human editing feature still works —
but no tools can be discovered. To see the agent side you need one of:

- **ChatGPT's in-app browser**, or
- **Google Chrome** with `chrome://flags/#enable-webmcp-testing` set to Enabled, then relaunch.

Once enabled, open the live URL and the tools panel (the `?` button on the board)
reports how many native tools registered. An agent can then call any of the 14.

### Automated native check

`npm test` exercises the command store directly. To exercise the real WebMCP
transport in a real browser instead:

```sh
npm i -D playwright-core
npm run test:native                                    # against localhost:3001
npm run test:native -- https://floortris.floortris.workers.dev/
```

It launches Chrome with the required flags, asserts all 14 tools register and
carry annotations, then runs a multi-turn journey through
`document.modelContext.executeTool`: read state, open a draft, plan a layout,
re-check it, and confirm a stale revision is refused and the locked owned sofa
never moved.

The native call contract, for anyone writing their own client:

```js
const tool = (await document.modelContext.getTools()).find(t => t.name === 'getRoomState');
const payload = JSON.parse(await document.modelContext.executeTool(tool, JSON.stringify({ which: 'current' })));
```

`executeTool` takes a `RegisteredTool` and a JSON **string**, and resolves to a
JSON string. Passing a tool name, a plain object, or `{arguments: ...}` fails with
`Failed to parse input arguments`.

## Source and verification

- `app/`: application entry and site metadata; `middleware.ts` supplies the platform-routed request origin for absolute social-card URLs, without trusting forwarded host headers.
- `components/floortris/FloortrisApp.tsx` and `floortris.css`: board, manual editing, measured-owned entry, catalogue, proposals/comparison, setup review, and exact-revision Apply.
- `components/floortris/model.ts`, `data.ts`, `engine.ts`: domain model, sample catalogue, and pure shared rules.
- `components/floortris/schemas.ts`, `store.ts`, `webmcp.ts`: strict tool schemas, authoritative commands, and native registration.
- Four test files in `components/floortris/`: 45 automated tests, combining the builder's 23 checks and 22 independently written acceptance/contract/adapter checks.

The initial integrated build passed all 52 tests, TypeScript checking and production compilation. Native discovery of all 14 tools and a native `getRoomState` call were verified in the local in-app browser; a creation attempt correctly refused to overwrite an existing human draft. Unit tests of the registration adapter use a controlled test double and are separate from that real browser evidence. Successful cross-client agent journeys still need target-browser testing.

An optional `store` prop on `FloortrisApp` supports isolated integration fixtures. `createStore` is independent of React. The default store is local to the mounted application; saved browser data is loaded after hydration.

## Independent command API

```ts
import { createStore } from './store.ts';
import { makeDemo } from './data.ts';

const store = createStore(makeDemo());
const s = store.getState(); // deeply frozen, stable immutable snapshot
await store.execute('createProposal', {
  kind: 'layout',
  expectedCurrentRevision: s.currentRevision,
  expectedRuleRevision: s.ruleRevision,
  idempotencyKey: 'my-creation-request',
});
const p = store.getState().proposal!;
const planned = await store.execute('proposeLayout', {
  proposalId: p.id,
  revision: p.revision,
});
```

`subscribe(listener)` returns an unsubscribe function. `execute(name, arguments, signal?)` returns a promise with `operationSucceeded` independently of geometric validation and required brief. A malformed, unauthorized, aborted or stale command never mutates the document. Authorized bad geometry can be committed as an inspectable, blocked proposal.

Human-only methods, **not registered tools**:

- `humanUpdate(which, objectId, patch)`; `humanAdd(which, variantId)`; `humanRemove(which, objectId)`
- `humanAddOwned({label, kind, sizeCm})`: adds a measured, required owned floor piece to Yours.
- `humanMeasureOwned(id, sizeCm)`; `humanSetLocks(id, locks)`; `humanSetRequired(id, boolean)`
- `humanSetRoomFinish(which, 'wall' | 'floor', paletteId)`: the human equivalent of `setAppearance` for room finishes.
- `applyProposal(proposalId, exactReviewedRevision)`
- `confirmSetup(proposalId, exactReviewedRevision)`
- `discardProposal()`; `resetDemo()`

`which` for human furniture methods is `current | proposal`. A human Current edit increments C; a human Proposal edit increments P. Ownership dimensions remain authoritative even if removal/position locks are explicitly cleared. Only the human may change a measured owned record, its requirement or locks. An owned item's size lock also protects removal, per the spec; the UI provides an explicit unlock-all action for an optional owned piece.

## Native tools

Exactly these names are registered:

`getRoomState`, `listFurniture`, `listCatalogue`, `setRoomGeometry`, `setOpening`, `setConstraints`, `createProposal`, `placeFurniture`, `updateFurniture`, `removeFurniture`, `proposeLayout`, `findPlacements`, `setAppearance`, `checkLayout`.

The adapter follows the **26 August 2026 draft**: [WebMCP community report](https://webmachinelearning.github.io/webmcp/). It awaits each `registerTool` result, supplies an AbortController signal as registration options for cleanup, reads `execute`'s `{signal}`, and returns the structured result directly. It only announces a registered state after all fourteen registrations resolve. Failure aborts that mount's registrations. Unsupported browsers retain the full human editor. Registration does not claim that an external agent has discovered or executed the tools.

Tools contain `readOnlyHint` plus `untrustedContentHint: true`, since user-entered labels are data and may appear in results. No tool performs Apply, Confirm room inputs, Discard, Unlock, or changes the selected UI view.

### Candidate scope

`findPlacements` returns immutable revision references with:

- `placementStatus: valid`: no hard issue affecting the requested piece and no newly introduced hard issue.
- `layoutStatus`: whole hypothetical layout status, including unrelated pre-existing issues.
- `remainingIssueCount`, `hasMoreRemainingIssues`, and per-issue cell counts.
- `details`: a `checkLayout` call containing `candidateId` to paginate the full hypothetical candidate report while its proposal/rule revision remains current.

Any document mutation invalidates the candidate cache. Applying a candidate checks its object/variant identity and revisions, then derives the actual committed report through the engine again. Read-only hypothetical detail inspection never commits that candidate.

### Bounded search

Candidate search checks at most 160 trial placements / 1800 ms and returns at most 8 candidates. It yields to the event loop every eight trials and honours aborts. The greedy planner prioritizes required lounge functions and uses a roughly 6500 ms overall placement budget, with a final trial allowed to finish; it commits only after checking the original proposal revision again. Cancellation or human edits during search prevent the result from committing.

The provided demo takes **four checked placements**: wall TV, compact desk, low table and rug. It meets the required brief and has zero hard failures or warnings. The planner does not deliberately produce a bad first proposal. Optional omissions are explicit; a smaller alternative is listed only after a real checked search and includes its checking basis. Search failure is not proof of infeasibility.

## Manual demo journey

1. The initial demo has a 600 × 480 cm room, a fixed-pose entrance, a fixed west window, radiator and measured locked 220 × 90 cm sofa. Yours is geometrically clear but its lounge brief is missing a TV.
2. Without any agent, click the **Frame TV · 120** catalogue card. It is anchored on the sofa-facing wall and targets the existing sofa. The initial room is now a complete valid lounge.
3. Add the compact Line desk, Pebble table and Weave rug through catalogue cards. Suggested initial human positions are real geometry, immediately checked. Move unlocked items by dragging, arrow keys, or position fields. Only named catalogue variants change catalogue size.
4. Or click **Try a proposal** to invoke the deterministic local planner. Yours stays selected and unchanged. Click **Inspect**, **Proposal** or **Compare** when you want to view it.
5. In Proposal, move the desk into the entrance sweep or select a larger variant that actually conflicts. Its real issues appear. Choose **Find checked placements**, then one of the revision-bound candidates to repair it.
6. **Review & apply** captures the exact displayed P. The final dialog rechecks it. If another edit arrives, Apply refuses the unreviewed revision.
7. Room setup stages dimensions, rules, doors and windows separately. **Confirm room inputs** shows the changed measurements, full JSON details and accepted requirements. It may make the current arrangement invalid; the engine does not revert your measurements to hide that.

## Geometry details and explicit limits

- Every positive-area furniture/cell intersection is occupied. Exact cell boundaries do not expand into the next cell. Supplied centimetres are never reduced to get a fit.
- A wall TV has no floor footprint. TV geometry uses its anchor, screen width, mount bottom and height. Facing derives from its wall. All intervening strip columns/rows are checked; only the target front seating cells are excluded, and at least one seating cell must be in scope.
- Low furniture blocks the floor route even when it passes the TV strip. Rugs do neither. Unknown height blocks the TV test. No optical, glare or actual sightline claim is made.
- A door's full 90° open leaf blocks walking; an empty swing reservation does not. Out-swing doors reserve their inside approach. Pocket/bifold/sliding mechanisms are explicitly unsupported and blocked, not approximated as hinges.
- Partial room-edge cells are outside the traversable grid. Entrance seeding uses the nearest fully interior edge. Outward approaches at non-grid furniture edges are snapped conservatively without changing measured dimensions.
- Every required sofa-front, other-door, storage-front or desk-approach destination must connect orthogonally to the entrance using the full hard-width square footprint. Unused pockets are not failures. Preferred-width connectivity is separate. The board's walking layer shows *local footprint fit*, while activity-zone flags show *entrance connectivity*.
- Desk chair-pull reservations exempt the linked chair from the unrelated-obstruction rule. Its solid still blocks walking. This V1 conservatively requires a free hard-width approach at the **outer edge** of the pull zone, not in the chair itself; this can use more space than a richer ergonomic model.
- A sofa front is a candidate target band, not a whole-band coffee-table ban. A table may occupy part while a reachable hard footprint remains.
- Window height checks are limited to a configured front band and sill-to-head interval. Unknown types warn that opening behavior is unverified. Side hinges use a **conservative full-depth rectangle**, not an exact dynamic sash model. Fixed and sash windows have no invented inward envelope.
- Fixed radiator projection and its 20 cm front assumption are separate masks. **The primary fixture radiator is not editable through this V1 UI or setup tools**. Changing to a smaller room may expose its out-of-room conflict; the UI discloses this fixed demo feature. A general fixed-equipment editor is a remaining product limitation.
- Rectangular rooms only, up to 1000 × 1000 cm, 12 openings and 30 movable pieces. 20 cm cells are fixed. Quarter turns only. No chimney/cutout editor, multi-room layout, stairs or diagonal paths.
- Storage uses a front rectangle, not a modelled articulated door. Bed long-side clearance is a secondary simple check; it cannot bypass the hard walking footprint.
- Furniture appearance is editable in the human inspector. Wall and floor finishes are editable there too, in the room panel shown when no piece is selected, through the same palette IDs `setAppearance` accepts. Appearance never changes geometry, height classes or rule flags, but it does advance the revision a reviewer must have seen before Apply.
- A stale draft must be discarded and recreated. There is no automatic rebase. Only one active setup/layout draft is supported at once. There is no undo history.
- Native calls have no backend, no secrets, no external APIs or real purchasing. The UI's local planner is deterministic page code and is labelled that way, never an external agent conversation.
- Room data is saved transparently in `localStorage` under `floortris.v1.local`. Export downloads JSON. There is no import UI or cloud synchronization. Creation/placement idempotency cache is session-local and bounded to 100 requests; it does not survive page reload.

These are product planning assumptions, not accessibility certification, building/fire regulation advice, radiator safety guidance, sunlight analysis or a surveyed real room.

## Board-first UI overhaul

The default workspace is the grid and a compact furniture dock. Pieces, Room and
Agent tools open one panel at a time; selecting a piece reveals a slim inspector.
Position fields are under the collapsed **Exact** section.

- Drag an existing piece to a 20 cm snap cell; the shared rule engine previews
  conflicts with hatched tiles and a rule-code label. Invalid existing moves are
  retained for visible repair. A gesture based on an intervening edit is refused.
- Use arrows to nudge one cell, Shift+arrow for five, and R to rotate. Pins and
  rotation buttons sit on the selected piece. Owned locks are changed in Yours;
  proposal-only catalogue pieces can also be pinned by the human.
- Catalogue corner handles select only named variants, never invented dimensions.
  Owned furniture has no resize handle.
- Drag a catalogue piece from the dock or Pieces drawer. TVs snap to wall cells;
  other pieces snap to the floor. New drops with relevant hard failures are
  refused atomically. Tap-to-add remains available, including on touch devices.
- Furniture / Height / Walk / TV / Doors are separate overlays, using patterns
  and labels. A native tool returning a blocked/unknown TV issue briefly shows
  the TV overlay and leaves an alert badge without changing the selected view.
- The proposal strip contains Try, status, View, Apply and Discard. Find placements
  displays checked, clickable ghosts; their exact candidate revisions are retained.
- Compare shows two boards side by side, with horizontal scrolling on small screens.

These changes retain the engine and the 14-tool schema. The optional native-result
observer cannot change a command result if a UI notification fails. Room data
continues to use the original local-storage format. No import, undo or general
fixed-fixture editor was added in this UI pass.
