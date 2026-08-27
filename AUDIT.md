# Floortris — audit against FLOORTRIS-SPEC.md

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

All **14 tools registered and were discoverable** through `document.modelContext.getTools()`.

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

1. **No JSON import.** Export writes a file with nothing to read it back.
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
