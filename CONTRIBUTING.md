# Contributing to CapDrop

First — thank you. CapDrop is only as useful as the capsules it ships with, and the best capsules come from people who have actually felt the pain of an AI that doesn't know its boundaries.

There are three ways to contribute:

- **Add a capsule** — the most common and most impactful contribution
- **Improve an existing capsule** — tighten a prompt, fix an edge case, add a missing boundary rule
- **Report or fix a bug** — extension behavior, WebSocket issues, build problems

---

## Adding a Capsule

All capsules live in one file:

```
extension/src/prompts.ts
```

They are entries in the `ALL_PERSONAS` array. Each capsule is a `PersonaDefinition` object:

```typescript
export interface PersonaDefinition {
  id: string;          // Unique snake_case identifier
  label: string;       // Display name shown in the library
  icon: string;        // Single emoji
  description: string; // One line shown under the label
  accent: string;      // Hex or HSL color (NOT a CSS variable)
  systemPrompt: string; // The full system prompt
}
```

### Step-by-step

**1. Fork and clone the repo**

```bash
git clone https://github.com/your-repo/capdrop
cd capdrop/extension
npm install
```

**2. Open `src/prompts.ts` and add your capsule to `ALL_PERSONAS`**

Add it at the end of the array, before the closing `]`:

```typescript
{
  id: "your_capsule_id",
  label: "Your Capsule Name",
  icon: "🚀",
  description: "One line shown in the library grid",
  accent: "#6366f1",
  systemPrompt: `YOUR SYSTEM PROMPT HERE`
}
```

**3. Test it locally**

```bash
npm run compile
npm run deploy
```

Reload VS Code (`Ctrl+Shift+P` → `Developer: Reload Window`), open the Capsule Library, and verify your capsule appears and activates correctly.

**4. Open a Pull Request**

Title format: `capsule: Add [Your Capsule Name]`

Include in the PR description:
- What the capsule does
- What files it allows
- What files it forbids
- Why you built it / what problem it solves

---

## Capsule Writing Guide

A good capsule prompt has five parts:

### 1. Identity declaration

State clearly who the AI is and what its expertise covers. Be specific — not "you are a developer" but "you are a Senior React Frontend Engineer" or "you are a Database Migration Specialist."

### 2. Allowed scope

List exactly which files and directories the AI may create or modify. Be explicit. Include file extensions, directory names, and naming patterns.

```
✅ .tsx / .jsx files inside /components, /pages, /ui
✅ .css / .module.css files
✅ index.html
```

### 3. Forbidden scope

List exactly what is off-limits. Be specific about file names and patterns that commonly get touched by accident.

```
❌ server.ts / server.js — FORBIDDEN
❌ database.ts / db.ts — FORBIDDEN
❌ /migrations/* — FORBIDDEN
❌ .env files — FORBIDDEN
```

### 4. The incompleteness rule

This is the most important part. Tell the AI explicitly that it is **allowed to ship incomplete work**. Without this, the AI will try to fill gaps itself.

```
IF the work you produce is incomplete without another layer:
→ That is CORRECT. That is BY DESIGN. Ship it anyway.
→ Leave a TODO comment: // TODO: Switch to [X] capsule to complete this
```

### 5. Escalation message

Define the exact string the AI should output when it hits its boundary:

```
"CAPSULE BOUNDARY REACHED: This task requires [X] work. 
Please switch to the [Y] capsule to complete: [one sentence].
The [Z] has been built to the extent possible."
```

---

## Capsule Quality Checklist

Before opening a PR, check:

- [ ] `id` is unique and snake_case
- [ ] `accent` is a hex or hsl value — not a CSS variable like `var(--clr-ui)`
- [ ] The prompt has a clear identity declaration
- [ ] The prompt lists explicitly allowed files
- [ ] The prompt lists explicitly forbidden files  
- [ ] The incompleteness rule is present
- [ ] The escalation message format is present
- [ ] The capsule compiles without TypeScript errors (`npm run compile`)
- [ ] The capsule appears in the library when tested locally
- [ ] The capsule activates and injects a prompt when selected

---

## Improving an Existing Capsule

If you find a capsule that's too permissive, too restrictive, or missing an edge case:

1. Edit the `systemPrompt` field directly in `prompts.ts`
2. Test with a real coding task that previously caused the boundary violation
3. Open a PR with title: `capsule: Improve [Capsule Name] — [what changed]`
4. In the description, include the specific scenario that triggered the issue and how the updated prompt handles it

---

## Reporting Bugs

Open an issue at [github.com/your-repo/capdrop/issues](https://github.com/kunalraha-ai/CapDrop/issues) with:

- VS Code version
- CapDrop version
- What you expected to happen
- What actually happened
- Relevant output from the **Output tab → CapDrop Agent** channel

---

## Extension Development

If you want to contribute to the extension itself (not just prompts):

```bash
cd extension

# Install deps
npm install

# Compile in watch mode
npm run watch

# Open extension folder in VS Code, then press F5
# This opens a [Extension Development Host] window
```

The extension source files:

| File | What it does |
|---|---|
| `extension.ts` | Activation, command registration, auth |
| `server.ts` | Local WebSocket server on `:5050` |
| `runner.ts` | Capsule session compiler, intent logger |
| `prompts.ts` | All capsule definitions |
| `logger.ts` | `intent_log.json` writer |
| `validator.ts` | Intent validation gate |
| `terminal.ts` | Secure build command executor |
| `integration.ts` | Build repair loop |
| `library.ts` | Capsule Library webview panel |

---

## Code Style

- TypeScript strict mode
- No `any`
- Async/await over raw Promises
- Descriptive variable names over comments
- Handle errors explicitly — no silent swallows

---

## Contributor Credits

Merged capsule contributors are:

- Listed in the README capsule table with their GitHub handle
- Credited in the marketplace changelog for that version
- Added to `CONTRIBUTORS.md` (created when the first external PR merges)

---

## Questions

Open a [Discussion](https://github.com/kunalraha-ai/CapDrop/discussions) or tag the issue with `question`.

---

*CapDrop is AGPL v3 licensed. By contributing you agree your contributions are also AGPL v3 licensed.*
