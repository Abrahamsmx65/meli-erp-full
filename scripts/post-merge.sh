#!/usr/bin/env bash
set -euo pipefail

# Reconcile dependencies after an isolated task is merged. `npm install` is
# idempotent, updates node_modules to the committed lockfile, and does not
# require interactive input.
npm install --no-audit --no-fund

# Catch incompatible merged TypeScript changes without running the complete
# test/build suite on every task merge.
npm run typecheck