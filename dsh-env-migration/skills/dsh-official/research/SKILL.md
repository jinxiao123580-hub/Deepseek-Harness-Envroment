---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.
---

Spin up a **background agent** to do the research, so you keep working while it reads.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. **Search to locate, `web_fetch` to read.** One search finds the URL; fetch that URL for its body. A search is a full auxiliary model request, so fetching is the cheap step and re-querying is the expensive one. Re-query only when the URL set itself is wrong.
3. **Treat a login wall as a source problem.** `registration required` is never answered by different words against the same host — switch to a public mirror (vendor git, ROS/URDF mirror, package registry, standards body, archive) and record which one worked.
4. Write the findings to a single Markdown file, citing each claim's source.
5. Save it where the repo already keeps such notes; match the existing convention, and if there is none, put it somewhere sensible and say where.
