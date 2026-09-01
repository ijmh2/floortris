# Floortris judge quick-start

Open <https://floortris.floortris.workers.dev> in ChatGPT's in-app browser or a
compatible Chrome WebMCP runtime. The **? / Agent tools** panel must report **16
native tools registered** and a dated contract release. Registration only proves
the page registered its tools; it does not claim an agent discovered or used them.

## Three-minute path

1. Ask the agent to create a measured L-shaped lounge with an entrance and window
   using `generateRoom`. The result opens in **Proposal** and preserves Yours.
2. Add a measured U-sectional with `createCustomFurniture`, then request a checked
   placement for the TV or another piece.
3. Ask for `checkLayout`, inspect the same result in 2D and 3D, and open Compare.
4. Confirm that Apply, room-input confirmation, Discard and Unlock are absent from
   the tool list. They are reserved for the human; do not use generic browser
   automation to activate those controls during the WebMCP demonstration.

## Current evidence

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:native -- https://floortris.floortris.workers.dev
```

`npm test` is the source of truth for the current test count rather than a number
copied into documentation. The native check asserts all 16 exact names, exact
`readOnlyHint` values, `untrustedContentHint: true`, closed input schemas, the
proposal/revision boundary, custom outlines, fixtures and measured sectionals.

The human-reserved controls are a WebMCP capability boundary, not a claim that a
general-purpose browser automation system cannot click visible controls.
