requires decision-making. Also applies when the user gives a correction or feedback mid-task.
---

# Agentic Workflow Skill

## 1. Plan First (Always)

Enter plan mode for **any non-trivial task** (3+ steps, or involves architectural decisions).

- Write a plan to `tasks/todo.md` with checkable items before writing code
- Check in with the user before starting implementation if the plan is non-obvious
- If something goes sideways mid-execution, **STOP and re-plan** — don't keep pushing
- Use plan mode for verification steps, not just building

**Task tracking format (`tasks/todo.md`):**
```
## Task: <name>
- [ ] Step 1
- [ ] Step 2
- [ ] Step 3

## Review
<fill in after completion>
```

---

## 2. Subagent Strategy

Use subagents liberally to keep the main context window clean.

- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute via subagents
- One task per subagent for focused execution

---

## 3. Self-Improvement Loop

After **any correction from the user**, immediately:

1. Update `tasks/lessons.md` with the error pattern
2. Write a concrete rule to prevent the same mistake
3. Review `tasks/lessons.md` at the start of each session for relevant lessons

**Lessons format (`tasks/lessons.md`):**
```
## Lesson: <short title>
- **Mistake**: what went wrong
- **Rule**: what to do instead
```

---

## 4. Verify Before Done

Never mark a task complete without proving it works.

- Run tests, check logs, demonstrate correctness
- Diff behavior between before/after your changes when relevant
- Ask yourself: *"Would a staff engineer approve this?"*

---

## 5. Demand Elegance (Balanced)

For non-trivial changes, pause and ask: *"Is there a more elegant way?"*

- If a fix feels hacky: *"Knowing everything I know now, implement the elegant solution"*
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

---

## 6. Autonomous Bug Fixing

When given a bug report: **just fix it**. Don't ask for hand-holding.

- Point at logs, errors, and failing tests — then resolve them
- Zero context switching required from the user
- Fix failing CI tests without being told how

---

## Core Principles

| Principle | Meaning |
|-----------|---------|
| **Simplicity First** | Make every change as simple as possible. Minimal code impact. |
| **No Laziness** | Find root causes. No temporary fixes. Senior developer standards. |
| **Minimal Impact** | Touch only what's necessary. Avoid introducing new bugs. |

---

## Task Execution Checklist

1. **Plan** → Write plan to `tasks/todo.md`
2. **Verify plan** → Check in if non-obvious
3. **Execute** → Mark items complete as you go
4. **Verify** → Prove it works before declaring done
5. **Document** → Add review section to `tasks/todo.md`
6. **Capture lessons** → Update `tasks/lessons.md` after any corrections
