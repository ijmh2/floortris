# Archived Floortris acceptance audit — historical snapshot

> **Archived:** this file describes an earlier 15-tool build and is retained only
> for provenance. It is not current release evidence. The current surface has 16
> native tools, including `createCustomFurniture`; use [JUDGE-QUICKSTART.md](./JUDGE-QUICKSTART.md),
> `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and
> `npm run test:native -- <URL>` for current, derived evidence. Do not rely on the
> historical test counts or model-specific runtime notes below.

27 August 2026. Source of truth for rules: `FLOORTRIS-SPEC.md` (Downloads copy and
`../FLOORTRIS-SPEC.md` are identical). Code audited: `components/floortris/`.

Baseline at audit time: 45 tests passing, `tsc --noEmit` clean, ESLint clean,
production build succeeds.

## 1. Where the code is ahead of the spec

These are deliberate improvements. The spec is the document that needs updating,
not the code.

| Area | Spec | Code |
|---|---|---|
| `facing` | §3.3 stores `rotation` **and** `facing`, which can disagree | `faces[rotation]` derives it. One source of truth. |
| Wall TV overlap | §6A.3 only allows a TV over a LOW console | `wall_attachment_overlap` checks wall position **and** height interval against every wall attachment and opening |
| Window sill | §6D.19 tests `h + elevation <= sillCm` | Also tests against `headCm`, and only inside a configured front band, so a tall piece well clear of the wall is not failed |
| Unknown windows | §6D.21 "no envelope, still enforce sill rule" | Same, plus an explicit `window_opening_unverified` warning so the gap is visible rather than silent |
| Zone reachability | §6F.34 requires paths to "reach" zones | A zone counts as reached when a hard-width footprint *overlaps* it (`softBand`). A literal read requires the square to fit *inside* the band, which no 40 cm sofa-front band could ever satisfy. |

## 2. Spec §7 code list is incomplete

§7 lists 26 codes. The engine emits four that are not in it:

`walk_tight`, `wall_attachment_overlap`, `window_opening_unverified`, and
`door_approach_blocked` used for "exactly one entrance" rather than a blocked approach.

The command layer additionally rejects with 24 codes that §7 never contemplates
(`active_proposal_exists`, `idempotency_conflict`, `unconfirmed_setup`,
`duplicate_owned_instance`, `room_limit`, …). These are transport-level refusals,
distinct from `validation.issues`, and the §8 envelope already separates
`operationSucceeded` from `validation.status`. **Action: extend §7, or state that
§7 covers engine issues only.** Nothing in the code needs to change.

Spec codes never emitted: `lock_violation` and `variant_unavailable` exist only as
command refusals, not engine issues; `omitted` is an array in the envelope, not an
issue code. That matches §8 and is correct.

## 3. Spec §12 open questions — as resolved in code

1. Cell size: **20 cm**, fixed (`Rules.cellCm: 20` is a literal type).
2. `walkHardCm`: **60**, with 80 preferred producing `walk_tight` warnings.
3. Sofa must face the TV: **block** (`tv_facing_wrong`, severity `block`), per the
   §12 default when a sofa is associated.
4. Radiator: present as a **fixed demo fixture**, not a general fixed-equipment
   editor. It is not editable through the UI or the setup tools.
5. Name: Floortris retained.

## 4. Confirmed correct against the spec

Conservative rasterisation (§6A.7); owned sizes immutable by tools (§6B.10);
rugs never solid and never block a route (§3.2, §6F.29); LOW blocks the floor
route but passes the TV strip (§6F.29 vs §6H.44); `UNKNOWN_HEIGHT` fails closed on
the TV test (§6A.4); open-leaf cells block pathing while empty sweep cells stay
walkable (§6C.14); no closed-door pose is ever substituted (§6C.15); pocket /
bifold / sliding are refused rather than approximated as hinges (§6C.17); path is
recomputed every edit with no frozen mask (§6F.32); dead pockets are not failures
(§6F.33); Apply, Discard, Unlock and view switching are human methods and are not
registered as tools (§1.12, §8).

## 5. Closed since the V1 verification

**Human room-finish parity.** `setAppearance` accepted `wall` and `floor` targets,
but the human inspector could only change furniture — a tool could do something a
person could not, which undercuts the "same functions behind both the tools and the
handles" claim the project rests on. Added `humanSetRoomFinish(which, target,
paletteId)` and wall/floor swatches in the room panel, with two tests asserting the
human path and the `setAppearance` path produce an identical layout and revision,
and that the finish changes nothing in the engine report.

The first cut of this shipped unreachable: `selected` initialises to `'owned-sofa'`
and nothing in the UI ever set it back to `null`, so the room panel could never
appear. Added a **Room finish** button in the inspector heading that clears the
selection. Verified in real Chrome: the button reveals both palettes and a wall
swatch repaints the board (`--wall` `#f4f1e8` to `#f5eade`).

## 5b. Native WebMCP evidence (27 August 2026)

Run against the dev server in **Google Chrome 151.0.7922.174**, driven by
`playwright-core` with `--enable-features=WebMCP,WebMachineLearningModelContext`
and `--enable-blink-features=WebMCP`. Without those flags `document.modelContext`
is absent, so the flags are a hard prerequisite for any demo or judging run.

All **15 tools registered and were discoverable** through `document.modelContext.getTools()`.

A five-turn agent journey ran natively, end to end:

| Turn | Call | Result |
|---|---|---|
| 1 | `getRoomState {which:'current'}` | ok, revisions read |
| 2 | `createProposal` at those exact revisions | ok, draft opened |
| 3 | `proposeLayout` | `ready_for_review`, 0 hard failures, 0 warnings |
| 4 | `checkLayout {which:'proposal'}` | `ok`, brief `satisfied` |
| 5 | `updateFurniture` with a deliberately stale revision | refused, `revision_conflict` |

**This closes open item 5 of the V1 verification's boundaries** for this browser:
the multi-turn journey is no longer a test double. What is still unproven is
whether a *language model* selects the right tools from these descriptions —
a discovery/prompting question, not a protocol one — and behaviour in the
competition's other test clients.

### Native call contract, as observed

`executeTool` is **not** name-based, and does not take a plain object:

```js
const tool = (await document.modelContext.getTools()).find(t => t.name === 'getRoomState');
const json = await document.modelContext.executeTool(tool, JSON.stringify({ which: 'current' }));
const payload = JSON.parse(json);          // returns a JSON string, not an object
```

Passing a name string, a plain args object, or `{arguments: ...}` all fail with
`Failed to parse input arguments`. `tool.inputSchema` also comes back as a JSON
string. The adapter in `webmcp.ts` is correct as written — Chrome serialises the
schema on registration and parses the arguments before calling `execute` — but
anyone writing a client or an eval against this page needs the shape above.

## 6. Open, in rough priority order

1. **Closed: validated JSON import.** Room → Import accepts a bounded, structurally validated Floortris export and opens it as a separate local document; it never overwrites the open room.
2. **No stale-draft rebase.** A stale draft must be discarded and recreated by a
   human; an agent that hits `stale_proposal` has no recovery path of its own.
3. **No undo history.**
4. **No general fixed-equipment editor** (the radiator is hard-coded).
5. **Target-browser acceptance.** Native registration, discovery and a five-turn
   journey are now verified in flagged Chrome 151 (§5b). Still unproven: the
   competition's other test clients, and whether a model picks the right tools
   from the descriptions unaided.
6. **Project location.** The tree lives under
   `Documents/Codex/2026-08-27/users-ivan-downloads-webmcp-cars-plan/outputs/`,
   a scratch path named after a different plan. Worth moving somewhere durable
   before the 3 September deadline.

## 7. Follow-up remediation (29 August 2026)

- Tool and UI wording now consistently names all 15 native tools, including
  `generateRoom`; public repo/video URLs remain intentionally blank in
  `SUBMISSION.md` until the owner publishes them.
- `proposeLayout.profile` was removed because room profile is authoritative in
  the proposal. Mutually exclusive placement and appearance schema shapes are
  rejected before dispatch. Planner retries are replay-safe only when an
  `idempotencyKey` is supplied.
- Desk/chair repairs now return executable public calls: link an existing chair,
  or find a checked linked-chair candidate and place it. Candidate linkage is
  retained through the public placement contract.
- Activity logs show only categories (for example, “catalogue piece”), never
  opaque IDs, idempotency keys, room names, or other free-form arguments.
- Optional owned pieces can be restored through the public `placeFurniture`
  contract and a matching human helper. The review modal traps focus, restores
  focus to whatever opened it, and cancels on Escape; while either modal is open
  the header and stage are `inert`, so the background leaves the tab order and
  the accessibility tree rather than relying on the trap alone.
- Fixed board fixtures are clickable again. They advertised a room-editor dialog
  and were keyboard-activatable, but a second `.ft-fixed` rule set `cursor:pointer`
  without overriding the earlier `pointer-events:none`, so mouse clicks were dead
  while the cursor promised otherwise. The label keeps `pointer-events:none`, and
  drags are unaffected because furniture drags hold pointer capture.
- The proposal button is **Re-plan draft**, not "Try again": the planner is
  deterministic, so an unchanged draft re-plans to the same arrangement. The
  label and its tooltip now say what the button does instead of implying variety.
- Static metadata removes request-header-driven metadata work; the production
  root no longer answers `no-store`. Middleware adds compatible `nosniff`,
  same-origin referrer, and restrictive permissions headers, and its matcher
  covers `/agent-guide` as well as `/`. Remote Google Fonts were removed in
  favour of system fallbacks.
- Testers are told to use **GPT-5.6 Sol or Terra**; Luna cannot call WebMCP tools
  today, and on Luna a working page looks broken.
- CI runs typecheck, lint, tests and production build. Asset/IP provenance is
  recorded in `docs/asset-provenance.md`.
- `native-check` asserts the `generateRoom` hero flow. Its layout assertion
  checks that the draft is *applicable* — not blocked, and reporting the same
  hard-failure count through both `generateRoom` and `checkLayout` — rather than
  demanding zero soft warnings, which a deliberately tight 300 x 450 bedroom
  cannot satisfy and does not need to.

## 8. Rule-correction pass (29 August 2026)

- Sofa/coffee-table handling now uses the sofa's rotated facing half-plane,
  lateral overlap and a 40–60 cm edge gap. Only a valid relationship receives
  the sofa-front occupancy exception; touching furniture blocks the frontage.
- A hinged in-swing door's open leaf is tested against wall attachments on an
  adjacent wall, so a TV behind the door cannot be accompanied by a green door
  or TV badge.
- Bed access is the intersection of valid and reachable long sides. Narrow
  storage fronts accept edge-overlap by the full walking footprint. Each office
  desk needs its own linked chair, and the chair must occupy that desk's pull zone.
- Wall-oriented catalogue pieces declare a local <code>backEdge</code>. Candidate
  search rotates it, tries exact centimetre-flush placements (including fractional
  cell origins), reports end-on contact as <code>side_against_wall</code>, and returns
  <code>backWall</code>, <code>backGapCm</code>, facing and checked-rule evidence.
- Candidate ranking assigns functional issues far more weight than decorative
  distribution, so the first valid coordinate no longer wins a semantic tie.
- Meeting tables declare all-side clearance; the day bed declares its long-side
  back; blanket-box wording matches its implemented front-access model.
- Health badges now have clear, warning, blocked and missing states. Fixed-fixture
  clearance failures emit one primary cause instead of duplicated route reports.
