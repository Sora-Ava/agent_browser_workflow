import { z } from "zod";

const schema = z.strictObject({
  text: z.string().trim().min(1).max(200),
  role: z
    .enum([
      "tab",
      "button",
      "link",
      "textbox",
      "combobox",
      "checkbox",
      "radio",
      "menuitem",
    ])
    .optional(),
  scope: z.string().trim().min(1).max(200).optional(),
  match: z.enum(["auto", "exact", "contains"]).default("auto"),
});
export function parseTextLocator(selector: string) {
  return selector.startsWith("text:")
    ? schema.parse(JSON.parse(selector.slice(5)))
    : null;
}

// Serialized into the page: all helpers must remain inside this function.
export function resolveTextInPage(
  input: { text: string; role?: string; scope?: string; match: string },
  token: string,
) {
  const norm = (s: string | null) => (s || "").replace(/\s+/g, " ").trim();
  const visible = (e: Element) =>
    !!e.getClientRects().length &&
    getComputedStyle(e).visibility !== "hidden" &&
    getComputedStyle(e).display !== "none" &&
    !e.closest('[aria-hidden="true"],[inert]');
  const role = (e: Element) =>
    e.getAttribute("role") ||
    (
      {
        BUTTON: "button",
        A: "link",
        SELECT: "combobox",
        TEXTAREA: "textbox",
      } as Record<string, string>
    )[e.tagName] ||
    (e.tagName === "INPUT"
      ? ["checkbox", "radio"].includes((e as HTMLInputElement).type)
        ? (e as HTMLInputElement).type
        : "textbox"
      : "");
  const actionable =
    'button,a[href],input:not([type="hidden"]),select,textarea,[role="tab"],[role="button"],[role="combobox"],[role="checkbox"],[role="radio"],[role="menuitem"],[onclick],[tabindex]';
  const all = Array.from(document.querySelectorAll("body *")).filter(
    (e) => !["SCRIPT", "STYLE", "NOSCRIPT"].includes(e.tagName) && visible(e),
  );
  const text = (e: Element) => norm(e.textContent);
  const needle = norm(input.text);
  const find = (exact: boolean) => {
    const matches = all.filter((e) =>
      exact ? text(e) === needle : text(e).includes(needle),
    );
    // Keep the smallest textual node, not every ancestor carrying the same text.
    const leaves = matches.filter(
      (e) => !matches.some((other) => other !== e && e.contains(other)),
    );
    const targets: Element[] = [];
    for (const leaf of leaves) {
      let target: Element = leaf;
      const label = leaf.closest("label");
      const associated =
        label instanceof HTMLLabelElement ? label.control : null;
      const parentAction = leaf.closest(actionable);
      if (associated && visible(associated)) target = associated;
      else if (parentAction && visible(parentAction)) target = parentAction;
      else {
        // Common component forms: label text and a sibling wrapped control.
        for (
          let container = leaf.parentElement, depth = 0;
          container && container !== document.body && depth < 3;
          container = container.parentElement, depth++
        ) {
          const controls = Array.from(
            container.querySelectorAll(
              'input:not([type="hidden"]),select,textarea,[role="combobox"]',
            ),
          ).filter(visible);
          if (controls.length === 1) {
            target = controls[0];
            break;
          }
          if (controls.length > 1) break;
        }
      }
      if (input.role && role(target) !== input.role) continue;
      if (input.scope) {
        let region: Element | null = target;
        while (
          region &&
          region !== document.body &&
          !text(region).includes(norm(input.scope))
        )
          region = region.parentElement;
        if (!region || region === document.body) continue;
      }
      if (!targets.includes(target)) targets.push(target);
    }
    return targets;
  };
  let targets = find(input.match !== "contains");
  if (!targets.length && input.match === "auto") targets = find(false);
  if (targets.length === 1) {
    document
      .querySelectorAll("[data-abw-text-target]")
      .forEach((e) => e.removeAttribute("data-abw-text-target"));
    targets[0].setAttribute("data-abw-text-target", token);
  }
  return {
    count: targets.length,
    selector: `[data-abw-text-target="${token}"]`,
    candidates: targets
      .slice(0, 8)
      .map((e) => ({
        tag: e.tagName,
        role: role(e),
        text: text(e).slice(0, 100),
      })),
  };
}
