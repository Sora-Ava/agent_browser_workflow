import { createApp } from "./app.ts";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
if (existsSync(".env")) loadEnvFile(".env");
const app = createApp();
app.server.listen(3001, "127.0.0.1", () =>
  console.log(
    "浏览器工作台：http://127.0.0.1:3001（开发模式前端：http://127.0.0.1:5173）",
  ),
);
