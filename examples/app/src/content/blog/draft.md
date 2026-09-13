---
title: A draft the compiler still sees
date: 2026-09-08
draft: true
---

svmd compiles every file the `include` glob matches, draft or not — filtering by `draft` is the
route's job, in `+page.ts`, not the compiler's. This post exists to prove exactly that: it never
shows up in [the blog listing](/blog), but its compiled route works if you visit it directly.
