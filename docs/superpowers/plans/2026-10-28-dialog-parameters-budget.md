# Dialog targeting, parameter confirmation and model budgets

User reports: dialogs not discovered; saved workflow misses inputs; excessive
LLM rounds and token use. Implement within existing local app and preserve flows.

1. Modal-first extraction before truncation; identify visible top dialogs and
   common custom component containers, include visible portal dropdowns. Exclude
   obscured background. Include surface title and bounded text context.
2. Derive input candidates deterministically from executed fill/select steps;
   credential references and sensitive fields excluded. Preserve known bindings.
   Add missing candidates automatically up to existing 30-param limit. Display
   all eligible inputs with parameter/fixed-value checkboxes, labels and defaults.
3. Default per-instruction model-call cap 8 (configurable 2..30), one locator
   recovery, bounded response tokens and recent messages. Keep current observed
   generation; discard historical DOM while preserving valid tool-call groups.
4. Tests first: dialog beyond >160 background controls and portal dropdown;
   inferred parameters/toggle; prompt budget + failure call cap. Real-browser UI
   and regression checks. Review then commit/push and safely update service.

UI: retain current white/ink/blue token system, typography and panel layout;
parallel rows show checkbox, field label/default and bound step numbers. Emphasis
is on reviewing what varies next time, not showing model/selector internals.

Verification completed: 44 unit/API/provider tests and production build pass.
Real Chrome fixture reproduces and fixes dialogs appended after180 background
controls, plus portal covering dialog center. Scoped indexing/click/replay pass.
Real workbench checkbox fixed/parameter toggle and saved bindings pass; screenshot
reviewed. Existing login/query/no-data/CSV replay and scripted exploration pass.
Review findings resolved: preserve full current goal/system rules, and detect
dialog independently of a portal covering its center. No intranet test performed.
