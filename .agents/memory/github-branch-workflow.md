---
name: GitHub branch workflow
description: How to safely persist commits for the imported private ERP repository.
---

Treat the remote GitHub branch as the source of truth. Create blobs, trees, commits, and non-force ref updates through the authenticated GitHub Git Data API; verify the expected parent SHA before every update.

**Why:** The private repository archive endpoint is blocked through the connector, and the workspace's local `.git` history belongs to the original scaffold rather than the upstream ERP history. A normal local push would not preserve the intended ancestry.

**How to apply:** Read the current remote branch ref first, stop if it differs from the expected parent, then create a commit tree based on that parent and update only the feature branch with `force: false`. Never update `main`.