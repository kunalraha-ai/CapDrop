"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBuiltInPersonaPrompt = getBuiltInPersonaPrompt;
exports.runAgentRunner = runAgentRunner;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const prompts_1 = require("./prompts");
const logger_1 = require("./logger");
function getBuiltInPersonaPrompt(persona) {
    const found = prompts_1.ALL_PERSONAS.find(p => p.id === persona);
    return found ? found.systemPrompt : "You are a senior software engineer.";
}
let _agentRunnerDebounceTimer;
async function runAgentRunner(context) {
    if (_agentRunnerDebounceTimer) {
        console.log("[AgentRunner] Debounced — already queued.");
        return;
    }
    _agentRunnerDebounceTimer = setTimeout(() => {
        _agentRunnerDebounceTimer = undefined;
    }, 2000);
    const activePersona = context.globalState.get("activePersona") || "backend";
    const _sessionId = context.globalState.get("activeSessionId") || "default-session";
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
    vscode.window.showInformationMessage(`🎭 Persona: ${activePersona.toUpperCase()} | Session: ${_sessionId} | Prompt: built-in`);
    logger_1.agentOutputChannel.clear();
    logger_1.agentOutputChannel.appendLine("=== COMPILED SYSTEM PROMPT ===");
    logger_1.agentOutputChannel.appendLine(fullSystemPrompt);
    logger_1.agentOutputChannel.show(true);
    (0, logger_1.clearIntentLog)(workspaceRoot);
    (0, logger_1.writeIntentLog)(workspaceRoot, {
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
//# sourceMappingURL=runner.js.map