---
name: learning-journal
description: Solve technical tasks while preserving an evidence-based Chinese learning journal of the investigation, decisions, commands, changes, verification, and reusable lessons. Use when the user wants to learn from delegated work, asks to record the process, requests a postmortem, or invokes this skill explicitly.
disable-model-invocation: false
allowed-tools: Bash, Write, Edit, Read
---

# Learning Journal

Complete the user's task normally and leave behind a useful, reproducible learning artifact. Optimize for teaching the user how to solve a similar problem independently next time.

## Language

Write the journal in the user's language. Use Chinese by default when the user writes in Chinese. Keep commands, identifiers, paths, error text, and code in their original form where accuracy matters.

## Output location

For each task, create one Markdown file under:

```text
<project-root>/learning/agent-journal/YYYY-MM-DD-short-task-name.md
```

Use the repository or project root when one is clear. Otherwise use the current working directory. Choose a short, filesystem-safe task name. If the target filename already exists, append `-2`, `-3`, and so on; do not overwrite an unrelated journal.

Do not add generated journals to version control unless the user asks. If the project has an ignore policy or explicitly excludes learning artifacts, respect it and choose a user-approved location when necessary.

## Work method

Create the journal near the beginning of substantive investigation and update it at meaningful milestones. Record observable facts while they are fresh; do not invent a detailed chronology afterward.

Before changing anything, capture:

- the user's goal in plain language;
- the current symptoms or starting state;
- what success will look like;
- the first investigation questions.

During the task, preserve only information with learning value:

- important files, components, and relationships discovered;
- key commands or tool actions, with their purpose and the useful part of their output;
- hypotheses and the evidence that supported or rejected them;
- meaningful failed attempts and what they taught;
- decisions, alternatives considered, and trade-offs;
- changes made, explained at the concept level rather than as a raw diff;
- tests or checks and their actual results.

Do not dump entire terminal transcripts, large source files, secrets, credentials, personal data, or noisy output. Redact sensitive values. Prefer short excerpts and point to relevant file paths or symbols.

## Required final structure

Keep the document proportional to the task. Use these sections, omitting a section only when it truly does not apply:

```markdown
# [Task title]

## 1. Goal and success criteria
## 2. System map and relevant context
## 3. Investigation trail
## 4. Root cause or key conclusion
## 5. Solution and why it works
## 6. Changes made
## 7. Verification and results
## 8. Failed approaches and lessons
## 9. Reusable mental model
## 10. Try it yourself
## 11. Further questions
## 12. Knowledge check (自测题)
```

For `Investigation trail`, use compact evidence entries such as:

```markdown
### Question or hypothesis
- Action: what was inspected or run
- Evidence: the relevant observation
- Conclusion: what follows from that evidence
```

In `Try it yourself`, give the user one small exercise that applies the central idea without simply repeating the whole task. Put the suggested solution inside a collapsed HTML `<details>` block when a concrete answer exists.

### 12. Knowledge check — auto-generated quiz from THIS task's content

Every journal MUST end with a self-test section titled `## 12. Knowledge check (自测题)` that quizzes the user on this specific task's material. Do NOT use generic or template questions — each question must reference concrete facts, paths, commands, or decisions from this journal.

Rules:

- **3–5 multiple-choice questions (选择题)**: each tests a real point of confusion, not trivia. Good targets: the root cause, why one approach failed, the mental-model ordering, or a threshold/parameter that matters. Each option must be plausible; the wrong options should be things the journal actually shows to be false (e.g. "链路断了" when evidence proved otherwise). Provide 4 options each, clearly lettered (A/B/C/D), with exactly one correct answer. Give the user a concrete scenario, not a bare fact recall, wherever possible.
- **2 short-answer questions (简答题)**: ask the user to explain in their own words (a) the root cause or the mental-model funnel, and (b) one failed approach and what it taught. For these, do NOT give a "correct answer" verbatim — instead provide a short list of **判分要点 (grading points)** inside the `<details>`: the 2–4 concrete facts the answer must contain to count as understood. This lets the user self-grade by coverage, not by matching a sentence.
- **Every question's answer goes inside a collapsed `<details><summary>答案</summary>...</details>` block** so the user can attempt first. For multiple choice, give the letter plus a one-line why (and why each wrong option is wrong). For short answers, give the grading points.
- Format the section as: one intro line ("先自己做，再点开答案，答错/想不起来的条目值得回看对应章节。"), then the questions grouped by type, then a closing line pointing back at which journal sections to revisit if several were wrong.
- If a question's content is genuinely task-specific with no reusable principle behind it, skip it — every question must teach something transferable.

## Reasoning boundary

Do not claim to expose private chain-of-thought, hidden reasoning tokens, or an exact internal monologue. Provide a concise, inspectable rationale instead: evidence, assumptions, decisions, alternatives, and validation. Clearly label uncertainty and inference.

## Completion

Do not let documentation replace solving the task. Finish and verify the requested work first, while maintaining the journal alongside it. In the final response:

- lead with the task outcome;
- link or provide the exact journal path;
- summarize the most transferable lesson in one or two sentences;
- mention any unresolved uncertainty honestly;
- point the user to the new `## 12. Knowledge check (自测题)` section and invite them to attempt it.

