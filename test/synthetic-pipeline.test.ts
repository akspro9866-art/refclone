import { test, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { runFiveStagePipeline } from "../src/index.ts";

describe("refclone: synthetic pipeline test with injected mock transport", () => {
  test("synthetic pipeline compiles and converges against ephemeral mock bridge without live Cavalry", async () => {
    // Ephemeral port 0 mock bridge
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += String(chunk);
      });
      req.on("end", () => {
        if (req.url === "/post" || req.url === "/batch-step" || req.url === "/batch_inspect") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, kind: "batch_inspect", timeline: {} }));
          return;
        }
        if (req.url === "/get") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true, kind: "status", capabilities: { batchEvalAndCapture: true } }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        resolve(typeof addr === "object" && addr ? addr.port : 0);
      });
    });

    const previousPort = process.env.STALLION_PORT;
    process.env.STALLION_PORT = String(port);

    try {
      const pipelineResult = await runFiveStagePipeline({
        elements: [
          {
            id: "card_primary",
            observations: [
              { frame: 0, x: 100, y: 150, width: 400, height: 250 },
              { frame: 30, x: 200, y: 150, width: 400, height: 250 },
            ],
          },
        ],
        fps: 60,
      });

      assert.equal(pipelineResult.completed, true);
      assert.equal(pipelineResult.stage3.version, "2.0");
      assert.equal(pipelineResult.stage4.operationsCount, 1);
      assert.ok(pipelineResult.stage4.script.includes('_mg.patch("card_primary"'));
      assert.equal(pipelineResult.stage5.passed, true);
    } finally {
      if (previousPort !== undefined) {
        process.env.STALLION_PORT = previousPort;
      } else {
        delete process.env.STALLION_PORT;
      }
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });
});
