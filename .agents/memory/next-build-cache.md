---
name: Next build cache
description: Recurrent local Next.js build failure caused by generated cache corruption.
---

When a local build fails inside Webpack `WasmHash._updateWithBuffer` with `Cannot read properties of undefined (reading 'length')`, treat the generated `.next` cache as corrupt before changing application code. Delete only `.next` and rerun the build once.

**Why:** This exact failure has recurred after otherwise clean typechecks and tests, and a clean rebuild succeeds without source changes.

**How to apply:** Use this only for the matching Webpack/WasmHash stack. Do not delete dependencies, lockfiles, source files, or broader caches unless a clean `.next` rebuild also fails.