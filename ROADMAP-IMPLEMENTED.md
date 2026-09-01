# Implemented local-first roadmap

Implemented in priority order after commit `02102dd`:

1. Three isolated, engine-checked placement strategies with score/trade-offs and human-only selection.
2. Seven difficult benchmark rooms with suggested agent prompts.
3. Two static accommodation packs with exact room identity, fixed furniture, approved inventory and restrictions.
4. Configurable advisory accessibility planning packs covering turning, routes, approaches, transfer, reach and projections.
5. Closed measurement provenance for labelled, provider, human-confirmed, inferred and estimated dimensions.
6. Static provider/product metadata with optional example price, supplier and pack compatibility; no live stock.
7. Gzip server-free URL-fragment room sharing with strict decode/size validation and JSON fallback.
8. `/evals` local benchmark runner plus checked-in snapshot; no telemetry or backend.
9. Client-side CSV furniture schedule and printable/PDF-friendly move-in HTML.

Non-goals remain deliberate: no website image parser, server/database, visual rule-overlay subsystem, human custom-furniture composer, auto-Apply, regulatory certification, live commerce or cloud sync.
