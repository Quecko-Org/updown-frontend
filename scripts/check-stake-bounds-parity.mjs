#!/usr/bin/env node
/**
 * Stake-bounds parity check.
 *
 * Frontend (`src/lib/stakeBounds.ts`) and backend SDK
 * (`updown-backend/sdk/typescript/src/eip712.ts`) both declare the
 * trading window — they MUST agree byte-for-byte on the atomic values.
 * This script grep-extracts the constants from both files and exits
 * non-zero if they diverge.
 *
 * Wired into `npm run build` via the `prebuild` script so a divergent
 * commit fails the Amplify build before deploying a stale-reference
 * trading UI to production.
 *
 * Backend repo path is resolved relative to this repo's parent dir:
 *   ../updown-backend/sdk/typescript/src/eip712.ts
 *
 * If the backend repo isn't checked out next to the frontend (i.e. the
 * Amplify runner), the script SKIPS rather than failing — the runner
 * doesn't have access to the sibling repo, so on Amplify the protection
 * only fires for local pre-push runs and CI runs that explicitly check
 * out both repos. That's acceptable: the parity check exists to catch
 * drift at author time, not to enforce a cross-repo invariant Amplify
 * has no way to validate.
 */

import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const FRONTEND_FILE = path.resolve(__dirname, "../src/lib/stakeBounds.ts");
const BACKEND_FILE = path.resolve(__dirname, "../../updown-backend/sdk/typescript/src/eip712.ts");

const FAIL = "\x1b[31m";
const OK = "\x1b[32m";
const WARN = "\x1b[33m";
const RESET = "\x1b[0m";

function readOrSkip(file, label) {
  if (!fs.existsSync(file)) {
    console.log(`${WARN}[stake-bounds] ${label} not found at ${file} — skipping parity check.${RESET}`);
    console.log(`${WARN}[stake-bounds] (this is expected on the Amplify runner; the check is enforced for local + CI runs.)${RESET}`);
    return null;
  }
  return fs.readFileSync(file, "utf8");
}

// Pull out `MIN_STAKE_ATOMIC = ...n` and `MAX_STAKE_ATOMIC = ...n`. Both
// files use the same naming, so a single regex serves. We normalize away
// `_` separators + the `n` BigInt suffix + `BigInt(...)` wrapper so a
// frontend `BigInt(5_000_000)` matches the SDK's `5_000_000n`.
function extract(source) {
  const grab = (name) => {
    const m = source.match(new RegExp(`(?:const|let|var)\\s+${name}\\s*(?::\\s*bigint)?\\s*=\\s*([^;\\n]+)`));
    if (!m) return null;
    const raw = m[1].trim();
    const cleaned = raw
      .replace(/^BigInt\(/, "")
      .replace(/\)$/, "")
      .replace(/_/g, "")
      .replace(/n$/, "")
      .trim();
    return cleaned;
  };
  return {
    MIN_STAKE_ATOMIC: grab("MIN_STAKE_ATOMIC"),
    MAX_STAKE_ATOMIC: grab("MAX_STAKE_ATOMIC"),
  };
}

const frontendSource = readOrSkip(FRONTEND_FILE, "frontend stakeBounds.ts");
const backendSource = readOrSkip(BACKEND_FILE, "backend SDK eip712.ts");

if (!frontendSource) {
  console.error(`${FAIL}[stake-bounds] frontend file missing — required.${RESET}`);
  process.exit(1);
}
if (!backendSource) {
  // Soft-skip — message already logged. Exit 0 so Amplify keeps building.
  process.exit(0);
}

const fe = extract(frontendSource);
const be = extract(backendSource);

const failures = [];
for (const key of Object.keys(fe)) {
  if (fe[key] == null) {
    failures.push(`frontend ${key} not found`);
    continue;
  }
  if (be[key] == null) {
    failures.push(`backend SDK ${key} not found`);
    continue;
  }
  if (fe[key] !== be[key]) {
    failures.push(`${key} mismatch: frontend=${fe[key]} backend=${be[key]}`);
  }
}

if (failures.length > 0) {
  console.error(`${FAIL}[stake-bounds] parity check FAILED:${RESET}`);
  for (const f of failures) console.error(`${FAIL}  - ${f}${RESET}`);
  console.error(
    `${FAIL}Both files must agree on MIN_STAKE_ATOMIC / MAX_STAKE_ATOMIC byte-for-byte.${RESET}`,
  );
  console.error(
    `${FAIL}If you intend to change the trading window, update both repos in the same change set.${RESET}`,
  );
  process.exit(1);
}

console.log(
  `${OK}[stake-bounds] parity OK — MIN=${fe.MIN_STAKE_ATOMIC} MAX=${fe.MAX_STAKE_ATOMIC} match across frontend + backend SDK.${RESET}`,
);
