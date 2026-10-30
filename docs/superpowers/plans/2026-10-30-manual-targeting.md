# Manual targeting, locator replacement and single-step tests

User approved stage one only. Keep existing independent browser and native
agent-browser execution. No graph editor or branch engine in this change.

Saved workflow steps with a single selector expose start/confirm/cancel picker.
Selection highlights a node; Alt selects its parent. Capture listeners intercept
press, release and click throughout selection, including repeated clicks.
Confirm validates current node identity and round-trip unique durable locator,
then saves a new workflow version changing only the selected locator. Original
version remains available. Single-step test executes on current page once, with
current parameter/credential settings, normal run log and no model calls.

Manual routes mutually exclude automation and guard final dispatch after async
validation. Picker target is bound to workflow/version and step index. Cancel
cleans listeners/highlight and releases the lock. Esc removes page interception;
use workbench Cancel Selection to release server-side selection ownership.

Manual observation additionally indexes noninteractive elements for extraction
and waits (up to2000 visible candidates in main document/current modal). No frame
or closed Shadow DOM expansion. Ambiguous/detached/changed nodes are rejected.

Validation: existing44 tests and production build pass. Independent real Chrome
fixture validates click/release/repeated-click suppression, automation lock,
version preservation, unique replacement, exactly-once zero-model step test and
cancel cleanup. Reviewer identified release-event and double-click activation
paths; both fixed and covered in the real fixture. UI screenshot captured.
