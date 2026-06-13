# CapDrop

> **Drop a capsule. Shift your AI's role. Ship better code.**

CapDrop gives your AI coding assistant a **job title and a contract**. 
Each capsule is a strict, role-specific system prompt that locks the AI 
into one lane — frontend only, backend only, tests only — and prevents 
it from "helpfully" doing work it wasn't asked to do.

No more AI that builds a database when you asked for a button.
No more AI that rewrites your server when you asked for a CSS fix.

---

## The Problem

AI coding assistants are powerful but undisciplined. They're trained to 
be helpful — which means when they hit a gap, they fill it. Ask for a 
login form and you'll get a login form *plus* an auth controller, a 
database schema, and a session handler you never asked for.

This creates integration nightmares. Files you didn't expect. Logic in 
the wrong layer. A codebase that looks complete but is actually a 
tangled mess owned by no one.

---

## How CapDrop Fixes It

CapDrop runs a **single AI session** at a time, locked to a specific 
role via a system prompt called a **Capsule**. Each capsule defines:

- Exactly which files the AI is allowed to touch
- Exactly which files are forbidden
- What to do when it hits the boundary of its role
- What message to output when it needs to escalate

When the AI reaches the edge of its role, it doesn't guess or overstep.
It outputs:
CAPSULE BOUNDARY REACHED: This task requires backend work.
Please switch to the Backend capsule to complete: [one sentence].
The frontend scaffold has been built to the extent possible.

Then it stops. You switch capsules. Work continues in the right lane.

---

## Capsules

| Capsule | Role | Allowed Files |
|---|---|---|
| 🎨 **UI / UX** | Frontend contractor | `.html`, `.css`, `/ui`, `/components`, `/pages` |
| ⚙️ **Backend** | Backend contractor | `server.*`, `db.*`, `/routes`, `/migrations`, `.env` |
| 🧪 **QA** | Test engineer | `*.test.*`, `*.spec.*`, `/tests`, `/e2e` |
| 🔒 **Security** | Auditor | `SECURITY_AUDIT.md` only — reads everything, writes nothing else |
| 🔗 **Integration** | Build repair | Import paths, build configs, tsconfig, package.json — no new features |
| 🤪 **Emoji Decorator** | Chaos agent | Frontend files only — adds emojis, touches nothing else |
| 📖 **Code Explainer** | Documenter | Adds docstrings and comments only — zero runtime changes |

---

## Bring Your Own Specs (Optional)

Drop a `PRD.md` and/or `TRD.md` in your workspace root and CapDrop 
automatically appends them to the active capsule's system prompt as 
anchored constraints. The AI must stay within both the capsule boundary 
**and** your spec.

No specs? No problem. Capsule boundaries apply regardless.

---

## Intent Logging

Every session writes a structured log to `.gemini/intent_log.json` in 
your workspace root. This records:

- Which capsule is active
- The session ID
- The compiled system prompt
- Proposed changes and validation hooks

This log is local only. Nothing is sent to the cloud.

---

## CapDrop Desktop Widget (Optional)

The optional **CapDrop Tauri desktop widget** is a borderless, 
always-on-top floating overlay that shows your active capsule team. 
It communicates with the VS Code extension over a local WebSocket 
(`ws://localhost:5050`). Clicking a capsule card in the widget shifts 
the active role instantly without opening the command palette.

---

## Privacy

- Your source code never leaves your machine
- No telemetry, no analytics, no accounts required
- No API keys needed — CapDrop injects prompts into your existing AI 
  assistant, it does not make its own LLM calls

---

## Contributing

Want a new capsule? Found a bug? Have a feature idea?

**[Open an issue or PR on GitHub →](https://github.com/kunalraha-ai/CapDrop)**

All capsules live in `prompts.ts` as entries in the `ALL_PERSONAS` 
array. Contributing a capsule is as simple as adding one object and 
opening a Pull Request:

```typescript
{
  id: "your_capsule_id",
  label: "Your Capsule Name", 
  icon: "🚀",
  description: "One line shown in the library",
  accent: "#6366f1",
  systemPrompt: `YOUR STRICT BOUNDARY PROMPT HERE`
}
```

Contributors whose capsules are merged get credited in the README and 
listed as official capsule authors on the marketplace page.
