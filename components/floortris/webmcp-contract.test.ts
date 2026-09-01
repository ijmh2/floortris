import test from 'node:test';
import assert from 'node:assert/strict';
import { HUMAN_ONLY_ACTIONS, WEBMCP_CONTRACT_RELEASE, WEBMCP_READ_ONLY_TOOLS, WEBMCP_TOOL_NAMES, webMcpContractErrors } from './webmcp-contract.ts';
import { TOOL_SCHEMAS } from './schemas.ts';

test('native contract has 16 exact closed tools and stable release evidence', () => {
  assert.match(WEBMCP_CONTRACT_RELEASE, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(WEBMCP_TOOL_NAMES.length, 16);
  assert.deepEqual(webMcpContractErrors(), []);
  for (const [name, spec] of Object.entries(TOOL_SCHEMAS)) assert.equal(spec.readOnly, WEBMCP_READ_ONLY_TOOLS.has(name), name);
  for (const action of HUMAN_ONLY_ACTIONS) assert.ok(!Object.hasOwn(TOOL_SCHEMAS, action), action);
});
