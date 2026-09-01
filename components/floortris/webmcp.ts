import { TOOL_SCHEMAS } from './schemas.ts';
import type { CommandResult } from './model.ts';
import type { FloortrisStore } from './store.ts';
import { AGENT_TOOL_POLICY, AGENT_UNAVAILABLE } from './agent-workflow.ts';
import { WEBMCP_CONTRACT_RELEASE, webMcpContractErrors } from './webmcp-contract.ts';
export type WebMCPState = { state: 'checking' | 'unsupported' | 'registered' | 'error'; count: number; message: string };
type NativeContext = { registerTool: (tool: { name: string; title?: string; description: string; inputSchema: unknown; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (args: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown> }, options?: { signal?: AbortSignal }) => Promise<void> | void };
declare global { interface Document { readonly modelContext?: NativeContext } }
/** Native draft API, 26 August 2026. No shim or navigator fallback is installed. */
export function registerFloortrisTools(store: FloortrisStore, onStatus: (status: WebMCPState) => void, hostDocument: Document = document, onToolResult?: (result: CommandResult) => void) {
  // Canonical production path: document.modelContext.registerTool. hostDocument
  // exists only to make feature detection and adapter tests deterministic.
  const modelContext = hostDocument.modelContext;
  const controller = new AbortController(); let disposed = false;
  if (!modelContext || typeof modelContext.registerTool !== 'function') { onStatus({ state: 'unsupported', count: 0, message: `This browser does not expose document.modelContext, so no native tools could be registered. Use a browser and agent runtime that support native WebMCP. ${AGENT_UNAVAILABLE} Human editing remains available.` }); return () => { disposed = true; controller.abort(); }; }
  const contractErrors = webMcpContractErrors();
  if (contractErrors.length) { onStatus({ state: 'error', count: 0, message: `Native contract ${WEBMCP_CONTRACT_RELEASE} failed validation: ${contractErrors.join('; ')}` }); return () => { disposed = true; controller.abort(); }; }
  onStatus({ state: 'checking', count: 0, message: 'Registering native document tools…' });
  const register = async () => {
    let count = 0;
    try {
      for (const [name, spec] of Object.entries(TOOL_SCHEMAS)) {
        if (disposed) return;
        await modelContext.registerTool({ name, title: spec.title, description: `${spec.description} ${AGENT_TOOL_POLICY}`, inputSchema: spec.inputSchema, annotations: { readOnlyHint: spec.readOnly, untrustedContentHint: true }, execute: async (args, options) => { const result = await store.execute(name, args, options?.signal); if (!disposed) { try { onToolResult?.(result); } catch { /* UI notification must never change an authoritative tool result. */ } } return result; } }, { signal: controller.signal });
        count++;
      }
      if (!disposed) onStatus({ state: 'registered', count, message: `${count} native document tools registered (contract ${WEBMCP_CONTRACT_RELEASE}). Registration is verified; external agent discovery and execution are not implied.` });
    } catch (error) {
      controller.abort();
      if (!disposed) onStatus({ state: 'error', count: 0, message: `Native registration failed; all registrations from this mount were cancelled. ${error instanceof Error ? error.message : String(error)} ${AGENT_UNAVAILABLE}` });
    }
  };
  void register();
  return () => { disposed = true; controller.abort(); };
}
