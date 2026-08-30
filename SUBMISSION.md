# Floortris — Devpost submission text

Live: **https://floortris.floortris.workers.dev**
Repo: _(add public URL)_ · Video: _(add YouTube URL)_

---

## What it is

A room planner that a person and an agent edit at the same time, on the same
grid, under the same rules. You measure what you already own and lock it. The
agent proposes an arrangement around it on a separate layer. You review and
apply. Nobody scrapes the DOM, and nobody clicks on your behalf.

Give the agent a dimensioned sketch and it can also recreate an L-shaped room,
alcove or nook as a validated rectilinear outline. The same missing corners are
absent from the visible 2D floor, the 3D model, walking routes and placement search.

The agent can finish that shell with measured curtains or blinds linked to a real
window and with ceiling, wall, floor and table lighting. Each mounting relationship
is explicit: a sconce names a derived wall segment, a table lamp names its support,
and a ceiling fixture must stay inside the actual L-shaped ceiling. These fixtures
use the same proposal/revision boundary and are rendered in both 2D and 3D.

## Why WebMCP fits this problem

**The floorplan is the product.** Delete the page and keep an API and you have
lost the thing that mattered: the tiles, the proposal layer, the locks, the
overlays, the human override. A room layout is spatial and contested — it is not
a chat transcript, and it is not a list of search results.

So the tools do not wrap a service behind the page. They wrap **the same
functions the drag handles call.** `updateFurniture` and dragging a sofa run the
identical code path into the identical rule engine. There is no second model of
the room that the agent reasons about and the human never sees, and no way for
the two to disagree.

That is the part WebMCP makes possible and an API could not: the agent acts *on
the artefact the human is already looking at*, and every consequence is rendered
immediately, in place, for a person who can veto it.

## How it improves the experience

An agent that could only talk would have to describe a layout. An agent with a
conventional API would mutate a database and hand back JSON. Here it moves real
furniture on the board you are watching, and the board answers back in the same
instant — 60 cm walking footprints, door sweeps, the TV sight strip, reachable
activity zones.

Crucially it **does not take the wheel.** The proposal never overwrites your
room. The view never switches under you. A status chip tells you the draft is
ready; you look when you want to. Apply is yours alone.

## Human and agent, sharing one document

The collaboration model is the design, not a feature:

- **Ownership.** Furniture you measured is `owned`. No tool can resize it, ever.
  The agent picks from named catalogue variants; it cannot invent millimetres.
- **Locks.** Lock a piece's position or rotation and the agent must plan around
  it. It reports `blocked` rather than quietly moving your sofa.
- **Two layers.** Current is yours. Proposal is the agent's draft, stamped with
  the Current revision it was built from.
- **Revisions.** Every tool call carries the revision it expects. Edit the draft
  yourself mid-search and the agent's next write is refused with
  `revision_conflict` instead of clobbering you. Change your room and the draft
  goes `stale` and cannot be applied.
- **Human-only actions.** Apply, Confirm room inputs, Discard, Unlock and
  switching view are **not registered as tools.** An agent cannot reach them.
- **Semantic flags, never colour.** Tools return `tv_blocked`, `path_broken`,
  `walk_tight`. Colour is a rendering decision the page makes locally.

## Implementation

**16 native tools** on `document.modelContext`: `generateRoom`, `getRoomState`, `listFurniture`,
`listCatalogue`, `createProposal`, `setRoomGeometry`, `setOpening`,
`setConstraints`, `createCustomFurniture`, `placeFurniture`, `updateFurniture`, `removeFurniture`,
`proposeLayout`, `findPlacements`, `setAppearance`, `checkLayout`.

Each is registered with a strict JSON Schema, `readOnlyHint`, and
`untrustedContentHint` — the latter because furniture labels are user-entered
text that flows into tool results. Registration awaits every promise and aborts
the whole mount on partial failure, so the UI never claims tools are available
when they are not. `execute` honours the caller's `AbortSignal`.

`createCustomFurniture` adds one-off measured floor furniture to Proposal only. Its closed kind enum activates the same engine rules, exact dimensions and provenance cannot be rewritten into a catalogue variant, and any newly introduced blocking issue refuses the creation atomically. The schema accepts no arbitrary tags, code, markup, URLs, role claims or wall/ceiling mounts. Custom objects show a visible CUSTOM identity and safe 2D/3D primitives inside their measured envelope; they remain local to the room document and still require human Apply.

Under them sits one pure rule engine on a 20 cm grid: conservative
rasterisation, height classes (a coffee table passes the TV strip but still
blocks the floor), door sweep versus open leaf and adjacent wall attachments,
clearance-aware flood fill for walking routes, and activity zones that must
connect to the entrance. Sofa/table gaps, usable bed sides, linked desk chairs
and explicit furniture back edges are checked as relationships rather than labels.
Window treatments are linked to openings; wall and table lights are linked to
mounts or supports; ceiling lights respect custom outlines. Lighting-zone feedback
is disclosed proximity guidance, not a photometric or electrical-code claim.
Unknown heights fail closed. Search is bounded — `findPlacements` returns only
engine-checked candidates, ranks functional geometry above decorative preferences,
and never claims a layout is impossible.

**Testing.** The command, engine and rendering tests run with `npm test`, and CI also runs typecheck, lint and production build. `npm run test:native`,
which drives real Chrome against the deployed URL and runs a multi-turn journey
through `document.modelContext.executeTool` — asserting all 16 tools register,
the `generateRoom` proposal flow reaches `ready_for_review`, a stale revision is
refused, and Apply/room confirmation are unavailable to native tools.

Stack: TypeScript, React, Next.js on the vinext runtime, deployed as a
Cloudflare Worker. No backend, no database, no LLM service. Room data stays in
your browser.

## How to test it

WebMCP is behind a flag today. Use **ChatGPT's in-app browser**, or **Chrome**
with `chrome://flags/#enable-webmcp-testing` enabled, then relaunch and open the
live URL. The `?` button on the board reports how many native tools registered.

In ChatGPT, choose **GPT-5.6 Sol** or **Terra**. **Luna cannot call WebMCP tools
today** — on Luna nothing is invoked, which resembles a broken page but is a
model limitation. The tools panel distinguishes them: it reports registration
independently of whether any model chooses to call.

Without the flag the page says so plainly and every human editing feature still
works — you simply cannot discover the tools.

## What it does not claim

Not accessibility certification, not building, fire or electrical regulations, no
optical TV visibility, sunlight, lux, glare or wiring modelling, no real purchasable SKUs. Rectangular and
custom rectilinear rooms, quarter turns, 20 cm cells; no curves, diagonals,
holes or multi-room plans. These limits are stated in the product itself, not
buried here.
