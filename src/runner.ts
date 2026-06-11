import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { ALL_PERSONAS } from "./prompts";
import { writeIntentLog, clearIntentLog, agentOutputChannel } from "./logger";

export function getBuiltInPersonaPrompt(persona: string): string {
  const found = ALL_PERSONAS.find(p => p.id === persona);
  return found ? found.systemPrompt : "You are a senior software engineer.";
}

let _agentRunnerDebounceTimer: ReturnType<typeof setTimeout> | undefined;

export async function runAgentRunner(context: vscode.ExtensionContext) {
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

  // Load persona prompt — built-in fallback
  const personaPrompt = getBuiltInPersonaPrompt(activePersona);

  // Load specs if they exist — optional, not required
  const prdPath = path.join(workspaceRoot, "PRD.md");
  const trdPath = path.join(workspaceRoot, "TRD.md");
  const prdContent = fs.existsSync(prdPath) ? fs.readFileSync(prdPath, "utf8") : null;
  const trdContent = fs.existsSync(trdPath) ? fs.readFileSync(trdPath, "utf8") : null;

  const specSection = (prdContent || trdContent)
    ? `\nWorkspace Specifications (Anchored Constraints):\n${prdContent ? `=== PRD ===\n${prdContent}\n` : ""}${trdContent ? `=== TRD ===\n${trdContent}\n` : ""}\nYou must only modify code in alignment with these specifications.`
    : "\nNo workspace specs found. Follow the persona boundary rules strictly.";

  const fullSystemPrompt = `${personaPrompt}\n${specSection}`;

  vscode.window.showInformationMessage(
    `🎭 Persona: ${activePersona.toUpperCase()} | Session: ${_sessionId} | Prompt: built-in`
  );

  agentOutputChannel.clear();
  agentOutputChannel.appendLine("=== COMPILED SYSTEM PROMPT ===");
  agentOutputChannel.appendLine(fullSystemPrompt);
  agentOutputChannel.show(true);

  clearIntentLog(workspaceRoot);
  writeIntentLog(workspaceRoot, {
    session_id: _sessionId,
    persona: activePersona,
    milestone: `Initialize ${activePersona} persona session`,
    reasoning: personaPrompt,
    proposed_changes: [],
    validation_hooks: [
      ...(prdContent ? ["PRD.md"] : []),
      ...(trdContent ? ["TRD.md"] : []),
    ],
  });
}
