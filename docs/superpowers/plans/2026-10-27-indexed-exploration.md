# Indexed exploration and durable recording

Approved by user: retain agent-browser for independent browser/navigation/download;
observe interactive elements with snapshot-scoped IDs and direct DOM references;
record successful actions as durable semantic locators for model-free replay.

Plan:
1. Add page-owned observation map with generation IDs, visible interactive DOM
   extraction (native/role/cursor/handlers), labels, contextual regions, and
   exclusion of disabled/hidden/covered targets.
2. Expose act_on tool for click/fill/select/download by observation ID + index.
   Reject stale/detached/changed targets before dispatch. Do not persist indices.
3. Generate a durable descriptor before dispatch, verify unique round-trip to
   the same node; record only after successful native agent-browser action.
   Use semantic text/role/name/context, stable attributes and verified structure;
   refuse ambiguity rather than choose first. Refresh observations after actions.
4. Keep old CSS/text workflows readable. Restrict indexed exploration to act_on
   for interactive actions; retain act for navigation, wait, extraction and checks.
5. Validate unit/provider contract, independent real-browser fixtures, full suite
   and build; review before committing/pushing and safely updating local service.

No third-party code is copied. Page Agent's architecture informs this original
implementation. Main document only; no iframe or closed Shadow DOM expansion.

Validation completed:
- 36 unit/provider/API tests and production build pass.
- Real Chrome indexed fixture passes including stale/detached nodes, changed
  generations, nested span tab, form labels, region disambiguation, parameter
  changes and model-free reload/replay.
- Reviewer found identity attrs were ignored for a single surviving semantic
  candidate; real Chrome regression reproduced the wrong-node replay. Enforcing
  attrs for all candidate counts fixed it; the same regression now passes.
- Real workbench chat/save/delete and legacy login/query/no-data/CSV download
  smoke tests pass. Scripted providers test protocol, not live LLM quality.
- Existing user intranet page has not been used as a test target.
