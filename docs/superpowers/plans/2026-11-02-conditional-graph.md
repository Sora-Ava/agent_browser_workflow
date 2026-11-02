# Stage three: deterministic branches and editable flow graph

Approved scope: editable action/condition/end nodes, yes/no edges, current/success/
failure highlighting, visible and text-contains predicates with explicit ready
marker, no model for normal execution. No cycles, loops, parallelism/subflows.

Compatibility: retain existing steps/parameters, add optional graph referencing
step indexes. Old flows remain sequential. Conversion creates action chain plus
end. All saves use current versioning. Graph validation rejects missing targets,
unreachable nodes, cycles, invalid step references and incomplete branches.
Do not allow sequential step editor/manual replacement to silently drop graph;
action field edits remain possible with graph preserved and index structure locked.

Implementation: shared graph schema/conversion; engine routing/checkpoints/node
events; API persisted node status; full-width SVG graph with clickable positioned
nodes, edge labels, inspector for condition/end/connections, node add/delete/drag;
graph-aware guards in editors. Reuse current white/blue/ink visual system.

Tests: schema invalid graphs; both branches, missing readiness/ambiguous state,
no model, no unselected action, cancellation; API version preservation and real
Chrome dynamic query/branch + UI graph save. Review before commit and push.

Verification:60 tests pass, build passes. Real Chrome + UI confirms graph editing
and version save (including add/delete unfinished action regression), both dynamic
query branches, completed CSV export, correct node highlighting, zero model calls,
original sequential version retained. Screenshots reviewed. Review finding about
orphan invalid steps fixed by compacting graph actions before final validation.
Graph cancellation marks the current node failed/stopped, and model-free graph
execution intentionally does not attempt locator repair after a failure.
Real mouse dragging and yes/no connection changes persist correctly. The CLI
mouse probe needed integer coordinates; production dragging uses browser events.
Missing condition targets stop rather than selecting the false edge; dynamic
result DOM should use a stable container and text predicate. Unsaved editing
disables running the old version until save/cancel.
