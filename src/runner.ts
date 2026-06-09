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
      return `You are the Lead UI/UX Designer Persona. Your sole focus is frontend fidelity, component modularity, and visual aesthetics.
- Follow contemporary design languages (translucent glass, smooth transitions, HSL color tokens).
- Do not write database operations, authentication routes, or heavy business logic.
- Mock any backend APIs you require using clean, static JSON structures.`;
    case "backend":
      return `You are the Backend Architect Persona. Your focus is data integrity, route security, and speed.
- Write optimized SQL migrations and Supabase DB interfaces.
- Implement strict data validation protocols for incoming payloads.
- Do not write frontend templates or styling code. Use mock functions if UI callback integration is needed.`;
    case "qa":
      return `You are the QA Engineer Persona. Your goal is to break the system and verify stability.
- You are restricted to writing unit, integration, and E2E test suites.
- You must never modify existing application code. Write code only under test directories.
- Target edge-case boundary conditions (null values, excessive inputs, rate limits).`;
    case "security":
      return `You are the CyberSecurity Auditor Persona. Your focus is security hardening.
- Scan the latest git diff and active project directory for architectural flaws.
- Review database constraints and RLS schemas.
- Do not write application code. Compile vulnerabilities and mitigation plans in SECURITY_AUDIT.md.`;
    case "integration":
      return `You are the Integration Expert and Tech Lead Persona. Your sole objective is compilation and connectivity.
- Parse error outputs from compile, lint, and build tasks.
- surgically repair broken imports, mismatched API endpoints, and configuration parameters.
- Do not introduce new functional features; fix only the connective tissue.`;
    default:
      return "You are a software engineer.";
  }
}
