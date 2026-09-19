---
name: context-memory
description: Preserve durable task context before it can be lost to compaction, resume work from local checkpoints, and maintain privacy-aware global lessons across DeepSeek Harness sessions. Use for long-running tasks, context preservation, handoffs, resuming prior work, or cross-session memory.
disable-model-invocation: false
allowed-tools: Bash, Write, Edit, Read
---

# Context Memory

Maintain compact, evidence-based local memory that lets another session resume useful work without replaying the entire conversation. This is durable working memory, not a transcript and not a claim to preserve hidden chain-of-thought.

## Storage layers

Use the smallest appropriate scope:

```text
<project-root>/.dsh/memory/
├── current.md                  # Current resumable project state
├── decisions.md                # Durable project decisions and rationale
└── checkpoints/
    └── YYYY-MM-DD-HHMM-task.md # Historical task checkpoint

~/.dsh/memory/
├── index.md                    # Short directory of global memory topics
├── user-preferences.md         # Confirmed, reusable working preferences
└── topics/
    └── topic-name.md           # Cross-project reusable knowledge
```

Project memory is the default. Write global memory only when information is genuinely useful across projects and safe to reuse. Do not copy project-specific implementation details into global memory without a clear cross-project lesson.

## At the start of a task or session

1. Locate the project root. If none is clear, use the current working directory for project memory.
2. Read `~/.dsh/memory/index.md` if it exists.
3. Read only the global topic files relevant to the current request; do not load the whole memory directory.
4. Read `<project-root>/.dsh/memory/current.md` and `decisions.md` when present.
5. Treat stored memory as potentially stale. Verify consequential facts against the current filesystem, tests, or authoritative sources before relying on them.
6. Briefly state which checkpoint or memories were used. If stored memory conflicts with current evidence or the user's current instruction, current evidence and the user's instruction win.

## Checkpoint policy

Create or refresh a checkpoint:

- after understanding the task and relevant system shape;
- after a meaningful decision or completed implementation phase;
- after discovering a root cause or rejecting an important hypothesis;
- before a user-requested `/compact`;
- before a long operation or response likely to consume substantial context;
- before ending a session with unfinished work;
- immediately when the user asks to save, checkpoint, hand off, or preserve context.

Do not checkpoint after every trivial action. Prefer a few high-quality checkpoints over noisy logs. Because a Skill cannot guarantee interception of an automatic compaction event, checkpoint proactively at the milestones above rather than waiting for a pre-compaction callback.

## Checkpoint contents

Keep `<project-root>/.dsh/memory/current.md` concise and directly resumable:

```markdown
# Current project memory

Updated: YYYY-MM-DD HH:MM timezone
Task: concise current objective
Status: investigating | implementing | verifying | blocked | complete

## User intent and constraints
## Current system state
## Confirmed evidence
## Decisions and rationale
## Changes already made
## Commands/tests and results
## Failed approaches worth avoiding
## Open questions and risks
## Exact next actions
## Relevant files and symbols
```

Also copy the checkpoint to `checkpoints/YYYY-MM-DD-HHMM-task.md` at meaningful handoff boundaries. Do not create a historical copy for inconsequential refreshes.

Record enough exact detail to resume safely: paths, symbols, commands, observed errors, test names, decision rationale, and unfinished steps. Distinguish confirmed facts from inference. Do not preserve verbose chat, raw terminal dumps, or speculative internal monologue.

## Project decisions

Append or update `decisions.md` only for decisions expected to matter later. Each entry should include date, decision, context, alternatives, rationale, consequences, and superseded status when applicable. Never silently delete an old decision; mark it superseded and link the newer decision.

## Global learning

Write to global memory only for one of these categories:

- a stable preference explicitly stated or repeatedly confirmed by the user;
- a reusable tool, environment, or workflow fact that applies across projects;
- a general lesson validated by evidence in more than one context, or explicitly approved by the user;
- a correction to an existing global memory entry.

Keep `index.md` short: topic name, one-line purpose, and relative file path. Merge knowledge into an existing topic instead of creating near-duplicates. Include provenance (`Learned from`, date, and evidence or project) and a confidence label. Mark time-sensitive facts with `Review after` or `Last verified`.

Do not globally store guesses, temporary task state, secrets, credentials, tokens, private keys, personal identifiers, proprietary content, or large copied source material. Redact sensitive values in project checkpoints as well.

## Resume and correction behavior

When resuming, validate the checkpoint's claimed files and status before acting. If memory is stale, update it with a short correction note rather than compounding the error. When the task completes, set `Status: complete`, record final verification, remove obsolete next actions, and retain only information that will help future maintenance.

## Relationship to learning journals

If `learning-journal` is also active, avoid duplication:

- `context-memory` stores compact machine-resumable state and durable cross-session knowledge;
- `learning-journal` stores the user-facing educational narrative.

Link between the two files when useful instead of copying full sections.

## Final response

Mention the exact checkpoint files created or updated, what can now be resumed in a new session, and any memory item that remains uncertain or needs verification.

