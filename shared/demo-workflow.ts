import type { Workflow } from "./workflow.ts";
export const demoWorkflow: Workflow = {
  name: "查询产品并导出",
  startUrl: "http://127.0.0.1:3001/demo",
  parameters: [
    { name: "product_name", label: "产品名称", defaultValue: "产品 A" },
  ],
  steps: [
    {
      type: "login",
      usernameSelector: "#username",
      passwordSelector: "#password",
      submitSelector: "#login-button",
      successSelector: "#app",
    },
    {
      type: "fill",
      selector: "#product",
      value: { parameter: "product_name" },
    },
    { type: "click", selector: "#search" },
    { type: "wait", selector: "#ready" },
    { type: "checkResults", emptySelector: "#empty", dataSelector: "#rows" },
    { type: "extract", selector: "#rows" },
    { type: "download", selector: "#export", filename: "products.csv" },
  ],
};
