---
title: Never compiled
date: 2026-09-10
---

This file starts with `_`, and `content.ts`'s glob explicitly excludes `**/_*.md` — the same
negative pattern `svmd`'s own `include`/`exclude` uses. It is never touched by the compiler at
all, unlike [the draft post](/blog/draft), which the compiler sees and only the route filters out.
