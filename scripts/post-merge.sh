#!/usr/bin/env bash
set -euo pipefail

# Reject lockfiles that would only install inside Replit, then install exactly
# what was committed without allowing npm to rewrite package-lock.json.
npm run validate:node-version
npm run validate:lockfile
npm ci --no-audit --no-fund
npm run validate:lockfile

# Catch incompatible merged TypeScript changes without running the complete
# test/build suite on every task merge.
npm run typecheck