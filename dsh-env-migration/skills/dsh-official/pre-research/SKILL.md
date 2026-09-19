---
name: pre-research
description: Land targeted documentation before starting the work. Fires on the user's request, before any other action, calls the `skill` tool with "grilling" first, then searches. Use for any implementation, configuration, integration, migration, upgrade, or tool-choice task whose correct shape depends on facts you have not read here. Skip when the task is already local, deterministic, or self-contained in this repo.
---

Reconnaissance before contact: establish what the correct work even _is_, then go find the sources that own it. The failure this prevents is building the wrong thing competently.

Once the search brief is locked, this skill is finished for the turn: work proceeds immediately.

## 1. Gate: is there a research front at all?

Run the reconnaissance when the correct approach is not already settled inside this repo or this machine. The front is real when the answer depends on an API surface, a config schema, a protocol, a version's behavior, a tool's capabilities, or a naming convention you have not read here.

Skip when the ask is local and deterministic: the file is in the workspace, the schema is in the code you can `read`, the behavior is in the plugin source on disk, the command's `--help` answers it. Local sources beat the web every time — read the source you already ship before searching for someone's description of it.

When skipping, say so in one line and proceed. That line is the whole output of this gate.

## 2. Interview: call `grilling`

Call the `skill` tool with "grilling" and run it. That skill owns the interview protocol — the design tree, the frontier, rounds, recommended answers. Follow it rather than reimplementing it here.

A finding you can look up yourself is never a question for the user. Dispatch a subagent for it, ask the rest of the frontier now, and let only the questions downstream of it wait.

The frontier here has a stopping rule the generic protocol does not: **stop once a round's answers would no longer change the queries.** You are converging on a search brief, not on a shared understanding of the whole design. A stop set by the brief is the completion criterion; an empty frontier is not required.

The brief is locked when each of these is pinned:

- **Question** — the specific thing being decided, phrased so a search either answers it or misses.
- **Version and surface** — product, version or release line, and the exact API, CLI, config file, or protocol at issue.
- **Constraint** — platform, runtime, dependency, license, or budget bound that rules candidates in or out.
- **Source tier** — where the authority for this question actually lives (§3), which is what decides the domain to search.
- **Done test** — what a sufficient answer looks like, so the search can stop.

## 3. Sources, in trust order

| Tier | What it is | How it is used |
|---|---|---|
| 1 | Official docs, specifications, and first-party source code | The answer. Every claim traces back to the source that owns it, not to a write-up of it. |
| 1b | The product's own repository: README, changelog, release notes, issues, and maintainer replies | The tie-breaker when docs and behavior disagree; dates settle which is current. |
| 2 | Named practitioner experience — blog posts, conference talks, migration write-ups | **Explicitly welcome.** Consulted for the operational reality docs omit: the gotcha, the version that broke, the thing that looked fine and wasn't. Label it as experience, not as documentation. |
| 3 | Community answers | A lead to tier 1, accepted only when tier 1 is silent. |

Content farms, unattributed aggregator posts, and AI-generated summary sites are residue — they report an answer with the authority stripped out. Use one only to locate the tier-1 source it copied, then cite that.

## 4. Search: targeted, never deep-first

Read the brief, then search from it. Each query names the pinned version and surface, because the version is what makes a query find one answer instead of five eras of them.

Start with the ordinary `web_search`, over queries written from the brief. That is the default and usually the whole search.

**Deep search is the escalation, never the opener.** Widen only when the targeted queries come back missing or contradictory, and when that happens, say which gap forced the widening. A first move that is already broad is how a precise question turns into an expensive one.

Each answer earns its citation: link the URL for every claim you will act on. An uncited claim is a guess wearing a citation's clothes.

### 4.1 Retrieval mechanics

Search **locates** a source; `web_fetch` **reads** it. A search is a full auxiliary model request, so the cheap path is one search to find the URL, then fetch that URL for its body — not another search.

- **Search returns URLs, rarely usable excerpts.** Exa and Perplexity return prose snippets; the shipped DeepSeek route returns `url`/`title`/`page_age` and derives its excerpt from the model's own citations, so an uncited result carries no text. When a result arrives with no excerpt, that is not a reason to search again.
- **Fetch the best URL instead of re-querying.** If `web_fetch` is available, call it on the top candidate. This costs no model turn; a repeat search costs a whole one. Bodies over 8 KB are spilled to disk as a preview plus a path — read or grep that path for the rest, and do not fetch the same URL twice.
- **Reword the query only when the URL set is wrong.** If the results are the right pages, the query is done working. Re-querying to obtain text a fetch would return is the single most expensive habit here.
- **A login wall is a source problem, not a query problem.** `registration required`, `sign in to download`, and `account needed` will never be answered by different words against the same host. Switch sources: the vendor's own git/ROS/URDF mirror, a public package registry, a mirror on a community or standards body, an archived copy. Record which public source actually worked.
  This is what the anti-pattern looks like in real transcripts — the wording admits the wall and searches anyway: `"CAD models" registration login required drawings`, `CAD download link login account required`, `CAD model available download support ticket`. Searching a vendor's support portal for "official answer" is not a source; it is a hope.
- **Never re-run a query another session already ran.** Check the repo's research notes and `~/.dsh/memory/` first; a settled answer that was never written down is paid for twice.

When the search outgrows a few queries, hand it to a subagent — but only with the locked brief as its entire instruction. The brief, not the conversation, is what makes the delegate precise; a subagent given the raw request will re-derive its own scope and come back vague.

## 5. Exit

The search ends on the brief's done test: every locked question answered, or answered-with-a-gap.

Report in this shape, and stop:

- **Findings** — what the sources settle, each with its URL.
- **Conflicts** — where tier 1 and tier 2 disagree, and which one wins here.
- **Gaps** — what the sources did not settle, and the assumption being made in its place.
- **Impact** — how this changes the work as originally asked, stated plainly when it does.

Then begin the work. An unrequested round of interview questions after the exit is friction, not diligence.
