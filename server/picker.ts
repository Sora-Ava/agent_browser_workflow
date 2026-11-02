// Runs in the target document. Selection never activates the clicked control.
export function pickerPage(op: string) {
  const w = window as any;
  if (op === "status") return w.__abwPicker?.result || null;
  w.__abwPicker?.stop();
  if (op === "cancel") return null;
  const box = document.createElement("div");
  box.setAttribute("data-abw-ignore", "true");
  box.style.cssText =
    "position:fixed;pointer-events:none;border:2px solid #2563eb;background:#2563eb22;z-index:2147483647";
  document.body.append(box);
  const state = w.__abwObservedElementsV1;
  let target: any;
  const move = (e: MouseEvent) => {
    target = null;
    for (
      let node = (
        e.altKey ? (e.target as Element).parentElement : e.target
      ) as Element | null;
      node;
      node = node.parentElement
    ) {
      for (const [index, entry] of state.map)
        if (entry.el === node) {
          target = { index, observationId: state.id };
          break;
        }
      if (target) {
        const r = node.getBoundingClientRect();
        Object.assign(box.style, {
          left: r.left + "px",
          top: r.top + "px",
          width: r.width + "px",
          height: r.height + "px",
        });
        break;
      }
    }
  };
  const block = (e: Event) => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  const click = (e: MouseEvent) => {
    block(e);
    move(e);
    if (target) {
      w.__abwPicker.result = target;
    }
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      block(e);
      stop();
    }
  };
  const stop = () => {
    box.remove();
    document.removeEventListener("mousemove", move, true);
    document.removeEventListener("click", click, true);
    document.removeEventListener("pointerdown", block, true);
    document.removeEventListener("mousedown", block, true);
    document.removeEventListener("pointerup", block, true);
    document.removeEventListener("mouseup", block, true);
    document.removeEventListener("keydown", key, true);
  };
  w.__abwPicker = { result: null, stop };
  document.addEventListener("mousemove", move, true);
  document.addEventListener("click", click, true);
  document.addEventListener("pointerdown", block, true);
  document.addEventListener("mousedown", block, true);
  document.addEventListener("pointerup", block, true);
  document.addEventListener("mouseup", block, true);
  document.addEventListener("keydown", key, true);
  return { started: true };
}
