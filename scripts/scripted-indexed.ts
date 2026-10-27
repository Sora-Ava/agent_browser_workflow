import assert from "node:assert/strict";
import type { Browser } from "../server/browser.ts";

// Test providers have a pre-authored scenario. Resolve its known fixture CSS to
// the public ID protocol; this helper is never part of production/model tools.
export async function scriptedIndexed(
  browser: Browser,
  name: string,
  args: any,
) {
  const step = args.step;
  if (
    name !== "act" ||
    !["click", "fill", "select", "download"].includes(step?.type)
  )
    return { name, args };
  const result = await browser.command([
    "eval",
    `(() => { const state=window.__abwObservedElementsV1; const el=document.querySelector(${JSON.stringify(step.selector)}); if(!state||!el)return null; for(const [index,entry] of state.map)if(entry.el===el)return {observationId:state.id,index}; return null; })()`,
  ]);
  assert.ok(
    result.result,
    `Fixture target missing from numbered observation: ${step.selector}`,
  );
  return {
    name: "act_on",
    args: {
      ...result.result,
      type: step.type,
      value: step.value,
      filename: step.filename,
    },
  };
}
