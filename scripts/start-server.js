/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require("node:child_process");

const host = process.env.HOSTNAME?.trim() || "0.0.0.0";
const port = process.env.PORT?.trim() || "3000";

const child = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "start", "-H", host, "-p", port],
  {
    stdio: "inherit",
    env: process.env,
  }
);

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error("Failed to start Next.js server:", error);
  process.exit(1);
});
