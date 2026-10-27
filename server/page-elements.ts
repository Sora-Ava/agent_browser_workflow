import { z } from "zod";

const descriptor = z.strictObject({
  tag: z.string().min(1).max(40),
  role: z.string().max(40),
  name: z.string().max(240),
  text: z.string().max(240),
  attrs: z.partialRecord(
    z.enum(["id", "name", "placeholder", "type", "data-testid", "data-test"]),
    z.string().max(240),
  ),
  region: z.string().max(240),
});
export function parseElementLocator(value: string) {
  return value.startsWith("element:")
    ? descriptor.parse(JSON.parse(value.slice(8)))
    : null;
}

// Original application-owned page code. No model-authored JavaScript is run.
// All helpers stay inside this function so it can be serialized by the adapter.
export function pageElements(op: "observe" | "prepare" | "resolve", arg: any) {
  const win = window as any;
  const key = "__abwObservedElementsV1";
  const norm = (s: string | null | undefined) =>
    (s || "").replace(/\s+/g, " ").trim().slice(0, 240);
  const visible = (el: Element) => {
    const s = getComputedStyle(el);
    return (
      !!el.getClientRects().length &&
      s.visibility !== "hidden" &&
      s.display !== "none" &&
      !el.closest('[hidden],[aria-hidden="true"],[inert]')
    );
  };
  const enabled = (el: Element) =>
    !el.matches(':disabled,[aria-disabled="true"]') &&
    !el.closest('[aria-disabled="true"]');
  const role = (el: Element) =>
    el.getAttribute("role") ||
    (
      {
        BUTTON: "button",
        A: "link",
        SELECT: "combobox",
        TEXTAREA: "textbox",
        INPUT: ["radio", "checkbox"].includes((el as HTMLInputElement).type)
          ? (el as HTMLInputElement).type
          : "textbox",
      } as Record<string, string>
    )[el.tagName] ||
    "";
  const interactive = (el: Element) => {
    if (
      !visible(el) ||
      !enabled(el) ||
      el === document.body ||
      el === document.documentElement ||
      el.matches("#root,#app,[data-abw-ignore]") ||
      el.closest("[data-abw-ignore]")
    )
      return false;
    if (
      el.matches(
        'button,a[href],input:not([type="hidden"]),textarea,select,[contenteditable="true"],[role="tab"],[role="button"],[role="combobox"],[role="menuitem"],[role="checkbox"],[role="radio"],[role="switch"],[role="option"],[tabindex]:not([tabindex="-1"]),[onclick]',
      ) ||
      typeof (el as HTMLElement).onclick === "function"
    )
      return true;
    // Cursor is inherited: do not index every span inside a clickable container.
    return (
      getComputedStyle(el).cursor === "pointer" &&
      (!el.parentElement ||
        getComputedStyle(el.parentElement).cursor !== "pointer")
    );
  };
  const describe = (el: Element) => {
    const labelled = (el.getAttribute("aria-labelledby") || "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ");
    const labels = Array.from((el as HTMLInputElement).labels || [])
      .map((label) => label.textContent)
      .join(" ");
    let label = norm(labels);
    // Common custom form wrappers with label text separate from the input.
    if (!label && el.matches('input,select,textarea,[role="combobox"]')) {
      const field = el.closest(
        '.el-form-item,.ant-form-item,.form-group,[role="group"]',
      );
      label = norm(
        field?.querySelector("label,.el-form-item__label,.ant-form-item-label")
          ?.textContent,
      );
    }
    const name = norm(
      el.getAttribute("aria-label") ||
        labelled.trim() ||
        label ||
        el.getAttribute("placeholder") ||
        el.getAttribute("title") ||
        (el.matches("input,textarea,select") ? "" : el.textContent),
    );
    const attrs: Record<string, string> = {};
    for (const a of [
      "id",
      "name",
      "placeholder",
      "type",
      "data-testid",
      "data-test",
    ]) {
      const value = el.getAttribute(a);
      if (value) attrs[a] = norm(value);
    }
    let region = "";
    for (
      let p = el.parentElement;
      p && p !== document.body;
      p = p.parentElement
    ) {
      if (
        !p.matches(
          'section,form,nav,fieldset,[role="dialog"],[role="tabpanel"],[role="group"],.el-form-item,.ant-form-item,.form-group',
        )
      )
        continue;
      const h = p.querySelector(
        "h1,h2,h3,h4,legend,label,.el-form-item__label,.ant-form-item-label",
      );
      const value = norm(p.getAttribute("aria-label") || h?.textContent || "");
      if (value) {
        region = value;
        break;
      }
    }
    return {
      tag: el.tagName,
      role: role(el),
      name,
      text: el.matches("input,textarea,select") ? "" : norm(el.textContent),
      attrs,
      region,
    };
  };
  const candidates = () =>
    Array.from(document.querySelectorAll("body *")).filter(interactive);
  const equivalent = (a: any, b: any) =>
    a.tag === b.tag &&
    a.role === b.role &&
    a.name === b.name &&
    a.text === b.text &&
    a.region === b.region;
  const resolve = (d: any) => {
    let found = candidates().filter((el) => equivalent(describe(el), d));
    // Attributes disambiguate structure only after semantic identity matches.
    // Never use DOM order or an ordinal fallback for duplicate Chinese labels.
    if (!d.name && !d.text && !Object.keys(d.attrs).length) return [];
    if (Object.keys(d.attrs).length)
      found = found.filter((el) =>
        Object.entries(d.attrs).every(([a, v]) => el.getAttribute(a) === v),
      );
    return found;
  };
  const mark = (el: Element, token: string) => {
    el.setAttribute("data-abw-index", token);
    return `[data-abw-index="${token}"]`;
  };
  const hit = (el: Element) => {
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(innerWidth - 1, r.x + r.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, r.y + r.height / 2));
    if (
      r.bottom <= 0 ||
      r.right <= 0 ||
      r.top >= innerHeight ||
      r.left >= innerWidth
    )
      return true; // native action scrolls
    const top = document.elementFromPoint(x, y);
    return !!top && (top === el || el.contains(top));
  };
  if (op === "observe") {
    const map = new Map<number, any>();
    const elements: any[] = [];
    let index = 0;
    for (const el of candidates()) {
      if (!hit(el)) continue;
      if (elements.length >= 160) break;
      const d = describe(el);
      index++;
      map.set(index, { el, descriptor: d });
      elements.push({
        index,
        tag: d.tag,
        role: d.role,
        name: d.name,
        text: d.text,
        region: d.region,
      });
    }
    win[key] = { id: arg.id, url: location.href, map };
    return {
      observationId: arg.id,
      elements,
      truncated: elements.length === 160,
    };
  }
  if (op === "prepare") {
    const state = win[key];
    if (!state || state.id !== arg.id || state.url !== location.href)
      throw new Error("观察编号已失效，请重新观察页面");
    const entry = state.map.get(arg.index);
    if (
      !entry ||
      !entry.el.isConnected ||
      !visible(entry.el) ||
      !enabled(entry.el) ||
      !hit(entry.el) ||
      JSON.stringify(describe(entry.el)) !== JSON.stringify(entry.descriptor)
    )
      throw new Error("目标已变化、不可操作或已离开页面，请重新观察");
    const found = resolve(entry.descriptor);
    if (found.length !== 1 || found[0] !== entry.el)
      throw new Error(
        "该元素无法生成唯一可重放定位，请补充目标区域或为页面提供稳定属性",
      );
    // Consume this generation before dispatch: a second action cannot use stale IDs.
    delete win[key];
    return {
      selector: mark(entry.el, arg.token),
      locator: "element:" + JSON.stringify(entry.descriptor),
      tag: entry.descriptor.tag,
    };
  }
  const found = resolve(arg.descriptor);
  return {
    count: found.length,
    selector: found.length === 1 ? mark(found[0], arg.token) : null,
  };
}
