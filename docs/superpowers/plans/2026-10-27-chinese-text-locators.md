# Chinese text locators

User approved: prioritize visible Chinese text, nested span/div content,
clickable ancestors and associated form controls. Do not choose the first
ambiguous match. Existing CSS workflows remain supported.

Implementation:
- Persist a string `text:{"text":"菜单","role":"tab"}` in existing selector fields.
- Optional role, scope text and exact/contains/auto matching; auto tries exact first.
- Resolve against current visible DOM on each execution, deduplicate ancestors,
  associate labels/nearby single controls and reject zero/multiple targets.
- Use a temporary application-owned marker only for the immediately following
  native agent-browser action. Never persist generated markers or JavaScript.
- Use the same resolver in exploration, preflight, replay and repaired locators.
- Keep potentially dispatched action failures terminal to avoid duplicate effects.

Validation: schema regression; full unit suite and build; independent real Chrome
fixture for nested span tab, label/input, sibling control, div card, hidden text,
duplicate text, scope, exact/partial matching and model-free recorded replay.

Limitations: main document only; dynamically changing DOM can still invalidate
the immediate target, and unusual custom controls may need explicit context/CSS.
The user's intranet page is not part of the synthetic browser validation.
