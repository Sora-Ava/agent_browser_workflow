import type { Server } from "node:http";
import { randomInt } from "node:crypto";

// Windows can allocate port 0 from a range containing Fetch-blocked ports.
// Use high loopback ports for fixtures so these tests never hit that policy.
export async function listenLocal(server: Server): Promise<void> {
  for (let attempt = 0; attempt < 32; attempt++) {
    const listening = await new Promise<boolean>((resolve, reject) => {
      const ready = () => {
        server.off("error", failed);
        resolve(true);
      };
      const failed = (error: NodeJS.ErrnoException) => {
        server.off("listening", ready);
        if (error.code === "EADDRINUSE" || error.code === "EACCES")
          resolve(false);
        else reject(error);
      };
      server.once("error", failed);
      server.once("listening", ready);
      server.listen(randomInt(20000, 50000), "127.0.0.1");
    });
    if (listening) return;
  }
  throw new Error("无法为测试站点分配可用的本机端口");
}
