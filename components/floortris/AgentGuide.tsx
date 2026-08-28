import React from 'react';
import { AGENT_TOOL_POLICY, AGENT_UNAVAILABLE, BEDROOM_TOOL_EXAMPLE } from './agent-workflow.ts';

/** Visible before hydration as well as in the working planner. */
export function AgentEntry() {
  return <aside className="ft-agent-entry" aria-label="Agent workflow">
    <p><strong>Agents: use WebMCP.</strong> Start with <code>generateRoom</code> → Proposal. The human clicks Apply. <a href="/agent-guide" target="_blank" rel="noopener">Agent guide ↗</a></p>
    <p>No native tool access? Report the blocker; do not use the manual planner as a fallback.</p>
  </aside>;
}

export default function AgentGuide() {
  return <article className="ft-agent-guide-content">
    <h2>Connect to the planner tab</h2>
    <p>Use the same browser tab the human is viewing. The planner registers native tools on <code>document.modelContext</code>; this guide page does not. Use your runtime’s documented browser WebMCP discovery and invocation capability on the planner tab. This is not a remote MCP endpoint.</p>
    <p>Do not guess commands such as <code>webmcp_list_tools</code>. A “WebMCP · registered” badge only confirms page registration, not that your agent runtime can invoke the tools.</p>
    <p className="ft-agent-stop">{AGENT_UNAVAILABLE}</p>
    <h2>Create a new room</h2>
    <ol>
      <li>Discover the planner tab’s native tools. Confirm <code>generateRoom</code> is available and read its schema.</li>
      <li>Call <code>generateRoom</code> with dimensions in centimetres, room profile and openings, including an entrance. A 3 × 4.5 m room is <code>widthCm: 300, depthCm: 450</code>. Ask about missing measurements or clearly agree provisional assumptions with the user.</li>
      <li>The page creates a separate furnished proposal, preserves the previous room, and shows the new room type and dimensions. Inspect <code>operationSucceeded</code>, <code>validation</code>, <code>brief</code> and <code>omitted</code>; successful execution does not mean a complete or valid layout.</li>
      <li>Verify with <code>getRoomState</code>, <code>listFurniture</code> and <code>checkLayout</code>, each with <code>{'which: "proposal"'}</code>. Use the returned proposal ID and latest revision for edits. Do not change views simply to read a different snapshot.</li>
      <li>Leave the furniture in Proposal. Confirm the human-facing planner tab shows the requested room heading, dimensions and proposal before saying it is visible. Report warnings and omissions, and invite the human to review and Apply.</li>
    </ol>
    <p><strong>{AGENT_TOOL_POLICY}</strong> Do not use “Try a proposal,” “Try again,” room forms, DOM scripts or direct storage edits as substitutes for native tools. Human editing stays available.</p>
    <h2>Keep the room visible to its owner</h2>
    <p>Rooms are saved in this browser’s local storage. A <code>?room=…</code> link selects an existing local room; it does not transfer a room to another browser, device or isolated agent session. If the user cannot see the room, verify the same browser session and active document before claiming it is open.</p>
    <h2>Edit the existing room</h2>
    <p>Read <code>getRoomState</code> first. Reuse its active layout proposal; if none exists, call <code>createProposal</code> with the accepted revisions. Use <code>proposeLayout</code>, <code>findPlacements</code> and furniture tools inside that draft. Changes to accepted room geometry, openings or rules require a setup proposal and human confirmation.</p>
    <h2>Example request, not a measured room</h2>
    <p>This example assumes a double bed, two bedside tables, storage, no workspace, no windows and an 80 cm south-wall entrance. Replace those assumptions with the user’s actual room. Discover the current schema before calling <code>generateRoom</code>; use a unique request key and keep it for retries.</p>
    <pre><code>{JSON.stringify(BEDROOM_TOOL_EXAMPLE, null, 2)}</code></pre>
  </article>;
}
