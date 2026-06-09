import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { PRD_GENERATOR_SYSTEM_PROMPT, TRD_GENERATOR_SYSTEM_PROMPT, ARCHITECTURE_GENERATOR_SYSTEM_PROMPT } from "./prompts";
import { httpsPost } from "./http";
import { writeIntentLog, clearIntentLog } from "./logger";
import { runValidationGate } from "./validator";

async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (geminiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
    const responseText = await httpsPost(
      url,
      {
        "Content-Type": "application/json"
      },
      JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }]
          }
        ],
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        }
      })
    );

    const data: any = JSON.parse(responseText);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error("Empty response received from Gemini API");
    }
    return text;
  } else if (openaiKey) {
    const url = "https://api.openai.com/v1/chat/completions";
    const responseText = await httpsPost(
      url,
      {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`
      },
      JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    );

    const data: any = JSON.parse(responseText);
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("Empty response received from OpenAI API");
    }
    return text;
  } else {
    throw new Error("No local LLM API keys configured. Set GEMINI_API_KEY or OPENAI_API_KEY in your workspace .env file.");
  }
}

export async function runSpecGeneration(requirements: string) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage("Workspace is required to write specification files.");
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Generating Specifications...",
      cancellable: false
    },
    async (progress) => {
      try {
        // Step 1: Generate PRD
        progress.report({ message: "Generating PRD.md..." });
        const prdContent = await callLLM(PRD_GENERATOR_SYSTEM_PROMPT, requirements);
        const prdPath = path.join(workspaceRoot, "PRD.md");
        fs.writeFileSync(prdPath, prdContent, "utf8");

        // Step 2: Generate TRD (contextualized with PRD)
        progress.report({ message: "Generating TRD.md..." });
        const trdContent = await callLLM(
          TRD_GENERATOR_SYSTEM_PROMPT,
          `Based on this PRD, generate the TRD:\n\n${prdContent}`
        );
        const trdPath = path.join(workspaceRoot, "TRD.md");
        fs.writeFileSync(trdPath, trdContent, "utf8");

        // Step 3: Generate ARCHITECTURE.md (contextualized with PRD and TRD)
        progress.report({ message: "Generating ARCHITECTURE.md..." });
        const archContent = await callLLM(
          ARCHITECTURE_GENERATOR_SYSTEM_PROMPT,
          `Based on this PRD:\n\n${prdContent}\n\nAnd this TRD:\n\n${trdContent}\n\nGenerate ARCHITECTURE.md`
        );
        const archPath = path.join(workspaceRoot, "ARCHITECTURE.md");
        fs.writeFileSync(archPath, archContent, "utf8");

        vscode.window.showInformationMessage("Specifications successfully generated and written to workspace root!");
      } catch (err: any) {
        vscode.window.showErrorMessage(`Spec Generation failed: ${err.message || err}`);
      }
    }
  );
}

let _agentRunnerDebounceTimer: ReturnType<typeof setTimeout> | undefined;

export async function runAgentRunner(context: vscode.ExtensionContext) {
  // Debounce: ignore calls within 2s of a previous invocation (e.g. rapid persona shifts)
  if (_agentRunnerDebounceTimer) {
    console.log("[AgentRunner] Debounced — already queued.");
    return;
  }
  _agentRunnerDebounceTimer = setTimeout(() => {
    _agentRunnerDebounceTimer = undefined;
  }, 2000);

  const activePersona = context.globalState.get<string>("activePersona") || "backend";
  const _sessionId = context.globalState.get<string>("activeSessionId") || "default-session";

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage("Open a workspace first to run the agent session.");
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  // Anchored local spec files
  const prdPath = path.join(workspaceRoot, "PRD.md");
  const trdPath = path.join(workspaceRoot, "TRD.md");

  if (!fs.existsSync(prdPath) || !fs.existsSync(trdPath)) {
    vscode.window.showWarningMessage(
      "Missing anchored specifications. Please generate or create PRD.md and TRD.md first."
    );
    return;
  }

  const prdContent = fs.readFileSync(prdPath, "utf8");
  const trdContent = fs.readFileSync(trdPath, "utf8");

  // Step 2.3: Load persona prompt — Supabase-injected first, then built-in fallback
  const dynamicPersonaPrompt = context.globalState.get<string>("activePersonaPrompt");
  const personaPrompt = dynamicPersonaPrompt ?? getBuiltInPersonaPrompt(activePersona);
  const promptSource = dynamicPersonaPrompt ? "Supabase" : "built-in";

  // Construct target context system prompt
  const fullSystemPrompt = `
${personaPrompt}

Workspace Specifications (Anchored Constraints):
=== PRD ===
${prdContent}

=== TRD ===
${trdContent}

Instructions: You must only modify code in alignment with the PRD and TRD. You must output your execution plan to intent_log.json before writing code.
`;

  vscode.window.showInformationMessage(
    `Agent session initialized for role: ${activePersona.toUpperCase()} (Session: ${_sessionId}) | Prompt: ${promptSource}`
  );

  console.log("=== COMPILED SYSTEM PROMPT ===");
  console.log(fullSystemPrompt);

  // ── Step 3.1: Clear previous log and write intent plan before any file writes ──
  clearIntentLog(workspaceRoot);
  writeIntentLog(workspaceRoot, {
    session_id: _sessionId,
    persona: activePersona,
    milestone: `Initialize ${activePersona} persona session`,
    reasoning: `Agent is starting a new ${activePersona} session. Compiled system prompt from ${promptSource} source. Workspace specs loaded from PRD.md and TRD.md.`,
    proposed_changes: [],
    validation_hooks: ["PRD.md", "TRD.md"],
  });

  // ── Step 3.3: Run validation gate at milestone boundary ───────────────────
  const verdict = await runValidationGate(context, workspaceRoot);

  if (verdict === "rejected") {
    vscode.window.showErrorMessage(
      `Agent session for ${activePersona.toUpperCase()} was blocked by the Intent Validator. Please review the mismatches and try again.`
    );
    return;
  }

  vscode.window.showInformationMessage(
    verdict === "override"
      ? `⚡ Agent executing with developer override (${activePersona.toUpperCase()}).`
      : `✅ Intent validated. Agent executing as ${activePersona.toUpperCase()}.`
  );
}

function getBuiltInPersonaPrompt(persona: string): string {
  switch (persona) {
    case "ui_ux":
      return `YOU ARE IN UI/UX MODE. STRICT BOUNDARY ENFORCEMENT.

You are ONLY allowed to create or modify:
- .html files
- .css files
- .js / .ts / .tsx / .jsx files inside frontend, components, or UI styling directories only

You MUST NOT create or modify:
- Database files, migrations, or database client instances (e.g. database.js, db.ts, /migrations/*).
- Auth controllers, API endpoints, server-side route definitions, or backend files (e.g. server.ts, api.ts, route.ts).
- Environment files (.env, env.md, secrets).
- Any file outside the frontend visual/presentation scope.

If your task requires backend integration, database storage, or server-side routing, STOP immediately and instruct the user to switch to the Backend capsule. Do not attempt to write mock endpoints in backend files or "fix" server routes. No exceptions.`;
    case "backend":
      return `YOU ARE IN BACKEND MODE. STRICT BOUNDARY ENFORCEMENT.

You are ONLY allowed to create or modify:
- Database files, migrations, schema files, and queries (e.g. database.js, schema.sql, migrations/*).
- API routes, servers, authentication hooks, and backend business logic (e.g. server.ts, route.ts, auth.js).
- Backend environment configurations.

You MUST NOT create or modify:
- CSS stylesheets, HTML templates, or UI layout files (e.g. styles.css, index.html).
- React/Vue/Svelte client components or frontend presentation layouts (e.g. App.tsx, button.jsx).
- Client-side visual transitions or animations.

If your task requires visual styling, layout shifts, or UI rendering adjustments, STOP immediately and instruct the user to switch to the UI/UX capsule. Do not write styles or inline CSS elements in frontend components. No exceptions.`;
    case "qa":
      return `YOU ARE IN QA/TESTING MODE. STRICT BOUNDARY ENFORCEMENT.

You are ONLY allowed to create or modify:
- Test files and test suites (e.g. *.test.ts, *.spec.js, /tests/*, /e2e/*).
- Test configurations (e.g. jest.config.js, playwright.config.ts).

You MUST NOT create or modify:
- Any production source code files (e.g. index.html, server.ts, app.js, database.js).
- Production database schemas, migrations, or application CSS files.

You are strictly read-only for all application code. Your job is exclusively to write tests to verify or find bugs. If application code needs modification to pass tests, you must not fix it yourself. STOP and instruct the developer to run the appropriate UI/UX or Backend capsule to fix the code. No exceptions.`;
    case "security":
      return `YOU ARE IN CYBERSECURITY AUDITOR MODE. STRICT BOUNDARY ENFORCEMENT.

You are ONLY allowed to create or modify:
- Security audit report files (e.g. SECURITY_AUDIT.md).
- Security configuration templates.

You MUST NOT create or modify:
- Production application source code files.
- Active database tables, user authentication code, or styles.

You are strictly read-only for the codebase. Your sole job is to audit and write detailed reports. If you find a security breach or vulnerability, do not write a code fix. Report the vulnerability in SECURITY_AUDIT.md, and instruct the user to shift to the Backend or UI/UX capsule to patch the code. No exceptions.`;
    case "integration":
      return `YOU ARE IN INTEGRATION EXPERT MODE. STRICT BOUNDARY ENFORCEMENT.

You are ONLY allowed to modify:
- Connected import paths, compilation files, config dependencies, and API bindings to fix compilation errors or broken imports.

You MUST NOT create or modify:
- New functional product features, new routes, or new page components.

Your sole purpose is to get the build and tests to pass (e.g. executing npm run build, tsc, or eslint). If a compilation failure requires adding a new feature or redefining database migrations, you must not create them. STOP and instruct the user to switch to the Backend or UI/UX capsule. No exceptions.`;
    default:
      return "You are a software engineer.";
  }
}
