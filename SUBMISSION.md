# Floortris — Devpost submission text

Live: **https://floortris.floortris.workers.dev**
Repo: _(add public URL)_ · Video: _(add YouTube URL)_

---

## What it is

A room planner that a person and an agent edit at the same time, on the same
grid, under the same rules. You measure what you already own and lock it. The
agent proposes an arrangement around it on a separate layer. You review and
apply. Nobody scrapes the DOM, and nobody clicks on your behalf.

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

**14 native tools** on `document.modelContext`: `getRoomState`, `listFurniture`,
`listCatalogue`, `createProposal`, `setRoomGeometry`, `setOpening`,
`setConstraints`, `placeFurniture`, `updateFurniture`, `removeFurniture`,
`proposeLayout`, `findPlacements`, `setAppearance`, `checkLayout`.

Each is registered with a strict JSON Schema, `readOnlyHint`, and
`untrustedContentHint` — the latter because furniture labels are user-entered
text that flows into tool results. Registration awaits every promise and aborts
the whole mount on partial failure, so the UI never claims tools are available
when they are not. `execute` honours the caller's `AbortSignal`.

Under them sits one pure rule engine on a 20 cm grid: conservative
rasterisation, height classes (a coffee table passes the TV strip but still
blocks the floor), door sweep versus open leaf, clearance-aware flood fill for
walking routes, and activity zones that must connect to the entrance. Unknown
heights fail closed. Search is bounded and deterministic — `findPlacements`
returns only engine-checked candidates, and never claims a layout is impossible.

**Testing.** 47 unit tests over the command store, plus `npm run test:native`,
which drives real Chrome against the deployed URL and runs a multi-turn journey
through `document.modelContext.executeTool` — asserting all 14 tools register,
a plan reaches `ready_for_review`, a stale revision is refused, and the locked
owned sofa never moved.

Stack: TypeScript, React, Next.js on the vinext runtime, deployed as a
Cloudflare Worker. No backend, no database, no LLM service. Room data stays in
your browser.

## How to test it

WebMCP is behind a flag today. Use **ChatGPT's in-app browser**, or **Chrome**
with `chrome://flags/#enable-webmcp-testing` enabled, then relaunch and open the
live URL. The `?` button on the board reports how many native tools registered.

Without the flag the page says so plainly and every human editing feature still
works — you simply cannot discover the tools.

## What it does not claim

Not accessibility certification, not building or fire regulations, no optical TV
visibility or sunlight modelling, no real purchasable SKUs. Rectangular rooms,
quarter turns, 20 cm cells. These limits are stated in the product itself, not
buried here.
