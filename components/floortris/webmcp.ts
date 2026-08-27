import { TOOL_SCHEMAS } from './schemas.ts';
import type { FloortrisStore } from './store.ts';
export type WebMCPState = { state: 'checking' | 'unsupported' | 'registered' | 'error'; count: number; message: string };
type NativeContext = { registerTool: (tool: { name: string; description: string; inputSchema: unknown; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (args: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown> }, options?: { signal?: AbortSignal }) => Promise<void> | void };
/** Native draft API, 26 August 2026. No shim or navigator fallback is installed. */
export function registerFloortrisTools(store: FloortrisStore, onStatus: (status: WebMCPState) => void, hostDocument: Document = document) {
  const native = (hostDocument as Document & { modelContext?: NativeContext }).modelContext;
  const controller = new AbortController(); let disposed = false;
  if (!native || typeof native.registerTool !== 'function') { onStatus({ state: 'unsupported', count: 0, message: 'This browser does not expose document.modelContext. All human editing and local planning still work.' }); return () => { disposed = true; controller.abort(); }; }
  onStatus({ state: 'checking', count: 0, message: 'Registering native document tools…' });
  const register = async () => {
    let count = 0;
    try {
      for (const [name, spec] of Object.entries(TOOL_SCHEMAS)) {
        if (disposed) return;
        await native.registerTool({ name, description: spec.description, inputSchema: spec.inputSchema, annotations: { readOnlyHint: spec.readOnly, untrustedContentHint: true }, execute: (args, options) => store.execute(name, args, options?.signal) }, { signal: controller.signal });
        count++;
      }
      if (!disposed) onStatus({ state: 'registered', count, message: `${count} native document tools registered. Registration is verified; external agent discovery and execution are not implied.` });
    } catch (error) {
      controller.abort();
      if (!disposed) onStatus({ state: 'error', count: 0, message: `Native registration failed; all registrations from this mount were cancelled. ${error instanceof Error ? error.message : String(error)}` });
    }
  };
  void register();
  return () => { disposed = true; controller.abort(); };
}
