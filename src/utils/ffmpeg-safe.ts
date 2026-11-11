/**
 * Windows FFmpeg Process & Temp Directory Cleanup (`src/utils/ffmpeg-safe.ts`).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

export function safeRm(dir: string): void {
  if (!fs.existsSync(dir)) return;
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
}

export interface FfmpegRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runFfmpegSafe(
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<FfmpegRunResult> {
  return new Promise((resolve, reject) => {
    let cp: import("node:child_process").ChildProcess;
    try {
      cp = spawn("ffmpeg", args, {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: options.cwd,
      });
    } catch (err) {
      return reject(err);
    }

    let stdout = "";
    let stderr = "";

    cp.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    cp.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    let timeoutTimer: NodeJS.Timeout | null = null;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        cp.kill("SIGKILL");
        reject(new Error(`ffmpeg execution timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
    }

    cp.on("error", (err) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      cp.stdout?.destroy();
      cp.stderr?.destroy();
      reject(err);
    });

    cp.on("close", (code) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      cp.stdout?.destroy();
      cp.stderr?.destroy();
      resolve({
        code: code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}
