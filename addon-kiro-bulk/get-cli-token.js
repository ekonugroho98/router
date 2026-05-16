#!/usr/bin/env node
/**
 * Print CLI token untuk akses /api/* di 9router yang requireLogin=ON.
 *
 * Token = first 16 chars of sha256(machine_id + "9r-cli-auth").
 * Same algorithm as src/lib/dashboardGuard.js → bypass auth.
 *
 * Usage:
 *   cd /Users/macbookpro/Projects/router
 *   node addon-kiro-bulk/get-cli-token.js
 *
 * Atau pas sidecar start:
 *   export KIRO_BULK_CLI_TOKEN=$(node addon-kiro-bulk/get-cli-token.js)
 *   cd addon-kiro-bulk && python server.py
 *
 * Note: script ini pake CommonJS (require) supaya jalan di project tanpa
 * "type":"module" di package.json.
 */
const { machineIdSync } = require("node-machine-id");
const crypto = require("crypto");

const CLI_TOKEN_SALT = "9r-cli-auth";

try {
  const rawId = machineIdSync();
  const token = crypto
    .createHash("sha256")
    .update(rawId + CLI_TOKEN_SALT)
    .digest("hex")
    .substring(0, 16);
  // Print just the token (so it's easy to capture in shell scripts)
  process.stdout.write(token + "\n");
} catch (e) {
  process.stderr.write(`Error: ${e.message}\n`);
  process.exit(1);
}
