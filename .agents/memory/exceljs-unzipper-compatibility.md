---
name: ExcelJS unzipper compatibility
description: Non-obvious Next.js build constraint when modernizing ExcelJS transitives.
---

When overriding ExcelJS transitives, keep `unzipper` at `0.12.1` unless a newer release removes or properly declares its static AWS SDK import.

**Why:** `unzipper` 0.12.2 and newer statically require `@aws-sdk/client-s3` from their general Open module without declaring it as a runtime dependency. Next.js follows that path through ExcelJS and fails the production build even when the application never uses S3. Version 0.12.1 removes the obsolete `fstream` chain without introducing that build failure.

**How to apply:** When revisiting ExcelJS or its overrides, test both real workbook reads/writes and the complete Next.js production build before moving `unzipper` beyond 0.12.1.