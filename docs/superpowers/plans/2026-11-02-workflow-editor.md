# Stage two: step editing and parameter bindings

User requested next stage after manual picking. Retain current workflow schema,
deterministic engine and version history. No branching/graph implementation yet.

Implement full-width editor for saved workflows: name/start URL; add/remove/move
and change actions; type-specific action fields; fixed/parameter/credential
sources for fill/select. Parameter names, labels/defaults editable; rename updates
all references; referenced parameter deletion blocked. Server validates full flow
and rejects saves during runs/picking. Save creates child version, leaves original
immutable. Editing and saving require neither browser launch nor model calls.

Validation:46 unit/API/provider tests and production build pass. API verifies new
version and rejects missing bindings without writes. Independent real-browser UI
checks fixed/parameter switching, defaults and version save with browser stopped.
Screenshots reviewed; moved editor out of narrow step sidebar into full width.
Read-only code review found no important correctness issues.
