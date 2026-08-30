# Floortris

A working room planner people and agents share. The page owns the rule engine; native WebMCP tools edit a visible proposal, and the human controls Apply and room-input confirmation.

## Agent entry point

Native WebMCP tools register automatically on planner mount, without a banner or
manual activation. Page metadata names WebMCP and a standard `rel="help"` link
points to `/agent-guide`; the same guide is available in the WebMCP panel.
These are discovery hints, not a guarantee of support in every agent runtime.
The workflow remains `generateRoom` → Proposal → human review. The guide explains discovery in the
human's existing planner tab, exact centimetre inputs, verification, existing-room
edits, and local-only room links. It does not register tools itself or invent a
runtime-specific discovery command. Read the tool schema on the planner tab.

All registered tool descriptions repeat the human approval boundary. Generation
returns a `review` record with `applied: false`, `requiresHumanApply: true`, and a
revision-bound `checkLayout` call. Agents should verify the visible room and report
warnings/omissions, then leave it in Proposal. If the runtime cannot invoke native
WebMCP, report the blocker and stop room edits; do not silently use the manual
planner or claim tool execution. Manual editing remains available to people.

Page guidance is not a security boundary: it cannot equip an unsupported runtime
with WebMCP or prove the human can see an isolated browser session. The registration
badge says only that this page registered its tools. Saved room URLs select local
documents; they do not transfer data across browsers or devices.

## Texture pack

Studio 01 adds four wallpapers (sage botanical, clay arches, blue gingham, woven linen) and two floors (pale oak planks, warm terrazzo). Choose thumbnails in Room → Walls / Floor. Agents use the same catalogue IDs through listCatalogue and setAppearance. Wallpaper previews in 3D; floors also show in the 2D furniture view. Finishes do not change rule flags or existing saved choices. See [texture-pack notes](docs/texture-pack.md) and [generation prompts](docs/texture-prompts.json).

## Local development

Use Node 22.13+ and npm. From this directory:

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

Open the local URL printed by the development server. The app uses React, TypeScript and the Sites/vinext runtime. Runtime room data stays in the browser; there is no LLM service, furniture-commerce API, or remote room database. The UI uses system-font fallbacks only; it does not fetch third-party fonts.

## Live demo and how to test it

**https://floortris.floortris.workers.dev**

WebMCP is behind a flag in Chrome today. Without it `document.modelContext` does
not exist, the page says so plainly, and every human editing feature still works —
but no tools can be discovered. To see the agent side you need one of:

- **ChatGPT's in-app browser**, or
- **Google Chrome** with `chrome://flags/#enable-webmcp-testing` set to Enabled, then relaunch.

In ChatGPT, pick a model that can actually call page tools: **GPT-5.6 Sol** or
**Terra**. **Luna does not support WebMCP today**, and on Luna the tools simply
never get called — which looks exactly like a broken integration but is not one.
The tools panel is the way to tell the two apart: if it reports registered tools,
the page is fine and the model is the limitation.

Once enabled, open the live URL and the tools panel (the tools status button above the board)
reports how many native tools registered. An agent can then call any of the 15.

### Automated native check

`npm test` exercises the command store directly. To exercise the real WebMCP
transport in a real browser instead:

```sh
npm i -D playwright-core
npm run test:native                                    # against localhost:3001
npm run test:native -- https://floortris.floortris.workers.dev/
```

It launches Chrome with the required flags, asserts all 15 tools register and
carry annotations, then exercises the `generateRoom` hero flow through
`document.modelContext.executeTool`: a new bedroom proposal is generated,
checked, and verified to remain human-Apply-only. It also confirms stale writes
are refused and that Apply, Confirm, Discard and Unlock are not native tools.

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
- Tests in `components/floortris/` cover the shared engine, command authority, native adapter, rendering geometry, room input editing and history. Run `npm test` for the current count.

The test suite, typecheck, lint and production build are run in CI. Native Chrome coverage is opt-in because it requires a locally installed Chrome with experimental flags. Unit tests of the registration adapter use a controlled test double and are separate from that real-browser evidence. Successful cross-client agent journeys still need target-browser testing.

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
- `humanRestoreOwned(which, objectId)`: returns an optional removed owned item from its authoritative measured inventory record.
- `humanAddOwned({label, kind, sizeCm, sleepSize?, storageRole?})`: adds a measured, required owned floor piece to Yours.
- `humanClassifyOwned(id, {sleepSize?, storageRole?})`: human-only bed/storage classification without resizing.
- `humanMeasureOwned(id, sizeCm)`; `humanSetLocks(id, locks)`; `humanSetRequired(id, boolean)`
- `humanSetRoomFinish(which, 'wall' | 'floor', paletteId)`: the human equivalent of `setAppearance` for room finishes.
- `applyProposal(proposalId, exactReviewedRevision)`
- `confirmSetup(proposalId, exactReviewedRevision)`
- `discardProposal()`; `resetDemo()`
- `humanStageRoom(room, rules, expectedStamp, replaceProposal?)`: atomic physical-room draft with optimistic concurrency and explicit replacement permission.
- `undo()`; `redo()`; `getHistory()`: session history with fresh authority tokens on restore.

`which` for human furniture methods is `current | proposal`. A human Current edit increments C; a human Proposal edit increments P. Ownership dimensions remain authoritative even if removal/position locks are explicitly cleared. Only the human may change a measured owned record, its requirement or locks. An owned item's size lock also protects removal, per the spec; the UI provides an explicit unlock-all action for an optional owned piece.

## Native tools

Exactly these names are registered:

`generateRoom`, `getRoomState`, `listFurniture`, `listCatalogue`, `setRoomGeometry`, `setOpening`, `setConstraints`, `createProposal`, `placeFurniture`, `updateFurniture`, `removeFurniture`, `proposeLayout`, `findPlacements`, `setAppearance`, `checkLayout`.

The adapter follows the **26 August 2026 draft**: [WebMCP community report](https://webmachinelearning.github.io/webmcp/). It awaits each `registerTool` result, supplies an AbortController signal as registration options for cleanup, reads `execute`'s `{signal}`, and returns the structured result directly. It only announces a registered state after all fifteen registrations resolve. Failure aborts that mount's registrations. Unsupported browsers retain the full human editor. Registration does not claim that an external agent has discovered or executed the tools.

Tools contain `readOnlyHint` plus `untrustedContentHint: true`, since user-entered labels are data and may appear in results. No tool performs Apply, Confirm room inputs, Discard, Unlock, or changes the selected UI view.

### Candidate scope

`findPlacements` returns immutable revision references with:

- `placementStatus: valid`: no hard issue affecting the requested piece and no newly introduced hard issue.
- `layoutStatus`: whole hypothetical layout status, including unrelated pre-existing issues.
- `qualityScore`: weighted remaining functional/advisory cost; lower is better. Door/TV safety, usable clearance, wall-backing and sofa/table geometry rank ahead of decorative distribution.
- `checkedRules`, `frontFacing`, `backWall`, `backGapCm`, and `touchingWalls`: engine-owned evidence for the candidate. Callers do not need to infer a bookshelf's back from a raw rotation.
- `remainingIssueCount`, `hasMoreRemainingIssues`, and per-issue cell counts.
- `details`: a `checkLayout` call containing `candidateId` to paginate the full hypothetical candidate report while its proposal/rule revision remains current.

Any document mutation invalidates the candidate cache. Applying a candidate checks its object/variant identity and revisions, then derives the actual committed report through the engine again. Read-only hypothetical detail inspection never commits that candidate.

### Bounded search

Candidate search checks at most 160 trial placements / 1800 ms and returns at most 8 candidates. It builds a small valid pool and sorts by functional quality rather than returning the first coordinate with the fewest issue objects. Wall-backed variants are tried flush at their measured centimetre depth before the general scan. It yields to the event loop every eight trials and honours aborts. The greedy planner prioritizes the selected room profile and required owned pieces and uses a roughly 6500 ms overall placement budget, with a final trial allowed to finish; it commits only after checking the original proposal revision again. Cancellation or human edits during search prevent the result from committing.

The provided demo takes **four checked placements**: wall TV, compact desk, low table and rug. It meets the required brief and has zero hard failures or warnings. The planner does not deliberately produce a bad first proposal. Optional omissions are explicit; a smaller alternative is listed only after a real checked search and includes its checking basis. Search failure is not proof of infeasibility. A planner retry is replay-safe only when the caller supplied the same `idempotencyKey`; otherwise it must refresh the proposal revision first.

## Manual demo journey

1. The initial demo has a 600 × 480 cm room, a fixed-pose entrance, a fixed west window, radiator and measured locked 220 × 90 cm sofa. Yours is geometrically clear but its lounge brief is missing a TV.
2. Without any agent, click the **Frame TV · 120** catalogue card. It is anchored on the sofa-facing wall and targets the existing sofa. The initial room is now a complete valid lounge.
3. Add the compact Line desk, Pebble table and Weave rug through catalogue cards. Suggested initial human positions are real geometry, immediately checked. Move unlocked items by dragging, arrow keys, or position fields. Only named catalogue variants change catalogue size.
4. Or click **Try a proposal** to invoke the bounded local planner. Yours stays selected and unchanged. Click **Inspect**, **Proposal** or **Compare** when you want to view it.
5. In Proposal, move the desk into the entrance sweep or select a larger variant that actually conflicts. Its real issues appear. Choose **Find checked placements**, then one of the revision-bound candidates to repair it.
6. **Review & apply** captures the exact displayed P. The final dialog rechecks it. If another edit arrives, Apply refuses the unreviewed revision.
7. Room setup stages dimensions, rules, doors and windows separately. **Confirm room inputs** shows the changed measurements, full JSON details and accepted requirements. It may make the current arrangement invalid; the engine does not revert your measurements to hide that.

## Geometry details and explicit limits

- Every positive-area furniture/cell intersection is occupied. Exact cell boundaries do not expand into the next cell. Supplied centimetres are never reduced to get a fit.
- A wall TV has no floor footprint. TV geometry uses its anchor, screen width, mount bottom and height. Facing derives from its wall. All intervening strip columns/rows are checked; only the target front seating cells are excluded, and at least one seating cell must be in scope.
- Low furniture blocks the floor route even when it passes the TV strip. Rugs do neither. Unknown height blocks the TV test. No optical, glare or actual sightline claim is made.
- A door's full 90° open leaf blocks walking; an empty swing reservation does not. The open leaf also blocks a wall attachment, including a TV, when it crosses that attachment's wall plane on an adjacent wall. Out-swing doors reserve their inside approach. Pocket/bifold/sliding mechanisms are explicitly unsupported and blocked, not approximated as hinges.
- Partial room-edge cells are outside the traversable grid. Entrance seeding uses the nearest fully interior edge. Outward approaches at non-grid furniture edges are snapped conservatively without changing measured dimensions.
- Every required sofa-front, other-door, storage-front or desk-approach destination must connect orthogonally to the entrance using the full hard-width square footprint. Unused pockets are not failures. Preferred-width connectivity is separate. The board's walking layer shows *local footprint fit*, while activity-zone flags show *entrance connectivity*.
- Each desk in an office brief needs its own linked chair. The chair must physically overlap that desk's pull zone; a distant chair with only a matching ID does not satisfy the relationship. Its solid still blocks walking, while the outer edge of the pull zone must remain reachable.
- A coffee table receives the sofa-front exception only when it overlaps the sofa laterally, lies in the sofa's actual facing half-plane and keeps a 40–60 cm edge gap. A touching or behind-the-sofa table blocks the frontage like other furniture.
- Storage approach zones may be reached by a hard-width walking footprint that overlaps their front edge. This keeps narrow cabinets reachable without pretending the walking square fits inside a narrower facade.
- Bed access counts only where a side is both geometrically valid and entrance-reachable. A reachable blocked side cannot substitute for the other usable side.
- Variants tagged <code>wall-backed</code> carry an explicit local back edge. The engine rotates that edge semantically, reports end-on wall contact as <code>side_against_wall</code>, and can place non-grid depths at exact centimetre-flush coordinates.
- Fixed fixture clearances report one primary cause: occupied, or unreachable when unoccupied. The general route rule does not duplicate the same failed fixture zone.
- Window height checks are limited to a configured front band and sill-to-head interval. Unknown types warn that opening behavior is unverified. Side hinges use a **conservative full-depth rectangle**, not an exact dynamic sash model. Fixed and sash windows have no invented inward envelope.
- Fixed radiator projection and its 20 cm front assumption are separate masks. The human Room Editor can add, remove, measure and pin radiators, doors and windows. Changes are staged and require confirmation. Agent furniture commands cannot edit fixed fixtures; accepted opening pins cannot be overridden by agent setup commands.
- Rectangular rooms only, up to 1000 × 1000 cm, 12 openings and 30 movable pieces. Interactive dragging, occupancy and flood-fill stay on fixed 20 cm cells; checked placements may use fractional cell coordinates to preserve exact measured wall gaps. Quarter turns only. No chimney/cutout editor, multi-room layout, stairs or diagonal paths.
- Storage uses a front rectangle, not a modelled articulated door. Meeting tables use a conservative all-side chair-clearance ring. Bed long-side clearance is a secondary simple check; it cannot bypass the hard walking footprint.
- Furniture appearance is editable in the human inspector. Wall and floor finishes are editable there too, in the room panel shown when no piece is selected, through the same palette IDs `setAppearance` accepts. Appearance never changes geometry, height classes or rule flags, but it does advance the revision a reviewer must have seen before Apply.
- A stale draft must be discarded and recreated. There is no automatic rebase. Only one active setup/layout draft is supported at once. Undo/redo holds up to 50 complete document states for the current session. Restoring content advances authority revisions and issues fresh proposal IDs, so old agent commands and Apply buttons do not regain validity.
- Native calls have no backend, no secrets, no external APIs or real purchasing. The UI's bounded local planner is page code, never an external agent conversation.
- Room data is saved in `localStorage`; the original lounge retains `floortris.v1.local` and the 3 m lounge retains `floortris.v1.sample.3m`. Every additional preset has an independent `floortris.v2.sample.*` key. Both V1 and V2 documents reload without resetting; migration adds a missing lounge profile without rewriting furniture or revisions. Export downloads JSON; Import validates a JSON export under 1 MB and opens it as a separate local room. There is no cloud synchronization. Creation, placement and opted-in planner idempotency caches are session-local and bounded to 100 requests; they do not survive page reload.

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

These changes retain the shared engine and the 15-tool surface. The optional native-result
observer cannot change a command result if a UI notification fails. Room documents now use version 2; both original lounge storage keys and all measured content remain compatible. The later room-editor release added staged fixed-feature editing, session undo/redo and validated local JSON import. There is still no cloud room synchronization.

## 3D architectural view

The **2D / 3D** toggle is presentation-only. Yours, Proposal and Compare use the
same accepted/proposed records and the same 15 native tool contracts. Three.js
loads only when the human selects 3D. Placement, checked ghosts and rule overlays
remain on the 2D board; the existing inspector can still edit a selected piece.

The renderer offers orbit, zoom, reset camera, optional wall cutaway and selection
by click or an accessible furniture selector. It displays measured dimensions,
cardinal rotations, wall-mounted TVs, window apertures, open door leaves and the
fixed radiator. Wall/floor/furniture palettes follow the current document. Render
resources, controls and event listeners are disposed when leaving 3D. A graphics
or chunk-load failure offers a return to the intact 2D planner.

These are simplified architectural models: door height is illustrative (2.1 m,
capped at the ceiling), null furniture heights use disclosed translucent 1 m
placeholders, window movement and real optical sightlines are not simulated.
No renderer mesh participates in validation. The existing TV height-strip and
walking assumptions stay unchanged, and comfort warnings remain visible.


## Bedrooms, home office and bathroom concepts

The **Rooms** picker switches independently saved documents. New sample furniture starts in a visible proposal; Yours is unchanged until the human presses Apply. Room purpose can also be changed in **Room → Room inputs & fixed fixtures**, staged with the other physical inputs and explicitly confirmed.

| Sample | Query | Starting arrangement |
| --- | --- | --- |
| Single bedroom | `?sample=bedroom-single` | 3 × 3 m, measured single-bed proposal |
| Double bedroom | `?sample=bedroom-double` | Double bed, twin bedside tables, clothes wardrobe |
| Home office | `?sample=office` | Linked desk/chair arrangement, storage |
| Bathroom concept | `?sample=bathroom` | Fixed basin, WC and shower tray; movable decor proposal |

Named bed frames are 100 × 200 × 95, 140 × 200 × 100 and 160 × 220 × 105 cm. Mattress dimensions are descriptive only. Side tables, wardrobes, a bench, tall office storage and a small mat extend the catalogue. Profile filters adapt the dock and Pieces panel. Owned beds and storage have human-controlled sleep-size/role classifications; agents cannot change them.

### Access and room briefs

- Bedrooms need the selected sleep size; clothing storage requires a wardrobe role, not just any storage object. A workspace needs a desk and linked chair. Requested bedside quantities are separate optional items.
- Bed side entry follows the head direction at every rotation. It reserves the configured depth (40 cm default), excludes at most 60 cm at the head, and retains at least 100 cm along the side. One side must connect to the entrance. A second side is a preference; nightstands remain solid.
- Offices require a desk and a linked chair. Optional guest seating is a distinct, unlinked chair. Storage is a separate preference. Desk/chair planning is atomic; it does not retain an unworkable desk alone.
- `proposeLayout` accepts bounded `quantities: [{variantId, quantity}]` alongside existing `variantIds`. An explicit quantity replaces the matching default count. Repeated variants get distinct IDs; retries do not grow the target count. Search remains bounded, and omissions are not proof that something cannot fit.
- Click clearance chips to show reachable (teal), preferred-tight (amber) or blocked (red hatch) zones. Issue buttons focus affected cells. Hover/focus a catalogue variant for measured footprint and clearance diagrams; drag onto the board for actual placement validation.

The 3D view includes beds with headboards, frames, pillows and bedding, plus distinct bathroom fixtures. These models stay inside their declared envelopes and do not participate in validation.

### Fixed bathroom concepts

Bathroom fixtures belong to room inputs, not movable furniture: basin/vanity, WC, shower tray, bath and towel rail. They have exact dimensions, quarter-turn poses, optional wall anchors, human pins and explicit external approach zones. The 2D/3D fixture controls open the same human Room Editor. Unpin to edit; Stage then Confirm publishes the inputs. Agents can arrange decor but cannot move these fixtures.

Clearance assumptions: basin 60 cm front; WC at least 60 cm wide × 80 cm deep front; shower 60 cm external entry; bath 60 cm along its long front side; towel rail no invented automatic zone. The 5 cm shower tray has no unmeasured tall glass. Fixture approaches remain outside solid footprints and connect to the same entrance path. Fixed fixtures fulfil their own brief without movable duplicates.

Every relevant result carries `conceptualOnly` when concepts are present, including mixed room profiles. These are spatial planning demonstrations only: **no plumbing, drainage, waterproofing, electrical, ventilation, structural, installation, accessibility, regulatory or safety assessment**.

### Expansion verification

Regression suites cover V1/V2 reloads, isolated documents, profile roles, exact repeated quantities, every bed orientation, fixed approaches, staged profile/history, owned classification, conceptual result markers and 3D envelope alignment. `npm test` reports the current total. Browser-level checks are separate from store/renderer tests; do not infer a verified browser journey merely from unit-test success.


## One-call room generation

Use native `generateRoom` to make a **new room**, even when the current room has
an active or stale proposal. It takes `name`, `widthCm`, `depthCm`, `profile`,
complete `openings` (including an entrance door), and `idempotencyKey`. Supported
profiles are lounge, bedroom and home_office. Optional `appearance`, `variantIds`
and `quantities` select palette IDs and named furniture variants. Bathroom
concept fixtures still use their existing human room-input workflow.

The tool uses the same bounded planner and rule engine, then atomically saves the
previous document and the new document before switching. A failure to save,
cancellation or intervening edit leaves the old room untouched. It never imports
an unrelated room's owned sofa, locks or fixed radiator into the new room. Partial
layouts report `validation`, `brief` and `omitted` honestly.

The human immediately sees the generated **Proposal**, its correct room type and
measurements in both 2D and 3D, and an updated furniture library. **Rooms → Your
saved rooms** retains the previous room and its draft. Furniture Apply remains
human-controlled. A single versioned `.workspace` local-storage record per sample
session holds separate documents; legacy saves remain readable and are not
overwritten. The active room survives reload, and `?room=<documentId>` selects a
saved room on this device (not a public room-sharing link). Undo history stays
within a document. Duplicate request keys are deduplicated within the active page
session; a replay for an inactive saved room reports `room_not_active`.

## Switching rooms

The **Rooms** picker changes the open document in state — `humanOpenRoom` on the
store, the same in-place switch `generateRoom` already performed. There is no page
load, so native registration is never torn down and rebuilt: the fifteen tools stay
live across a room change. `history.replaceState` keeps `?room=` and `?sample=` in
step, so an existing link still opens the same room on this device.

A switch clears session undo/redo — history never travels between documents — and
retains the outgoing room and its draft, both in memory and under its own sample
library's storage key. Because `generateRoom` switches the same way, the human is
already on the agent's new room and its proposal the moment the tool returns, ready
to edit alongside. Switching the Yours / Proposal / Compare **view** remains
human-only: no tool changes the selected view.

The piece dock is a left rail rather than a strip beneath the board. As a strip it
fell below the fold in a tall room, so the pieces you were about to drag sat
off-screen from the board you were dragging them onto. Board width is now capped by
the room's own aspect ratio against the remaining viewport height, so the rail, the
plan and the room check read together without scrolling.

Every room entry refreshes proposal authority and current/rule revisions, including
sample rooms that reuse IDs and a switch back to the same room. Queued edits,
captured Apply actions, planner results, retries and candidate references from the
previous entry cannot modify the newly opened room. Stale drafts remain stale.

Repair hints in proposal tool reports include the active `proposalId` and
`revision`, so their arguments can be passed directly to the named tool. Direct
moves and turns are checked against the full engine and ownership locks: they must
resolve the reported issue without adding hard failures or missing requirements.
Otherwise the hint requests a bounded placement search. Current-room, stale,
setup and hypothetical reports do not offer edits against the active layout draft.

The rail's **Owned furniture** button opens the inventory panel and its
**Add measured piece** form; owned measurements and locks remain human-controlled.
