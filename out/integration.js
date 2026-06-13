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
exports.analyzeErrors = analyzeErrors;
exports.runIntegrationLoop = runIntegrationLoop;
exports.getLastTraces = getLastTraces;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const terminal_1 = require("./terminal");
const logger_1 = require("./logger");
// ─── Max auto-correction iterations before forcing human review ───────────────
const MAX_CORRECTION_LOOPS = 3;
const ERROR_PATTERNS = [
    {
        name: "TypeScript type error",
        pattern: /error TS(\d+):\s*(.+)/i,
        suggestedFix: ([, code, msg]) => `Fix TypeScript error TS${code}: ${msg}. Check type declarations and ensure correct types are used.`,
    },
    {
        name: "Module not found",
        pattern: /Cannot find module '(.+?)'/i,
        suggestedFix: ([, mod]) => `Install missing module: npm install ${mod.replace(/^@types\//, "@types/")}. Or check import path.`,
    },
    {
        name: "npm build failure",
        pattern: /npm ERR! code (\w+)/i,
        suggestedFix: ([, code]) => `npm error code ${code}. Try: npm ci to reinstall all deps, or check package.json for invalid scripts.`,
    },
    {
        name: "Rust compile error",
        pattern: /^error\[E(\d+)\]:\s*(.+)/m,
        suggestedFix: ([, code, msg]) => `Fix Rust error E${code}: ${msg}. Run: cargo check for a detailed trace.`,
    },
    {
        name: "Webpack missing dependency",
        pattern: /Module not found: Error: Can't resolve '(.+?)'/i,
        suggestedFix: ([, dep]) => `Webpack cannot resolve '${dep}'. Install with: npm install ${dep} --save or --save-dev.`,
    },
    {
        name: "Permission denied",
        pattern: /EACCES:\s*permission denied/i,
        suggestedFix: () => `Permission denied. Check file ownership and ensure the workspace has write access.`,
    },
    {
        name: "Port in use",
        pattern: /EADDRINUSE.*:(\d+)/i,
        suggestedFix: ([, port]) => `Port ${port} is in use. Kill the occupying process or change the port in .env.`,
    },
];
function analyzeErrors(stderr, stdout) {
    const combined = `${stdout}\n${stderr}`;
    const errors = [];
    for (const ep of ERROR_PATTERNS) {
        const match = combined.match(ep.pattern);
        if (match) {
            errors.push({
                name: ep.name,
                rawMatch: match[0],
                suggestion: ep.suggestedFix(match),
            });
        }
    }
    return errors;
}
// ─── Integration Persona: Build & Correct Loop ───────────────────────────────
/**
 * Runs a build command, analyzes any errors, and loops correction attempts
 * up to MAX_CORRECTION_LOOPS times. At each iteration it:
 * 1. Runs the command and captures output.
 * 2. Writes the trace to terminal_traces.json.
 * 3. Analyzes stderr/stdout for known error patterns.
 * 4. If errors found → logs intent, runs validation gate, and suggests fixes.
 * 5. Retries until success or loop limit.
 */
async function runIntegrationLoop(context, workspaceRoot, buildCommand) {
    const sessionId = context.globalState.get("activeSessionId") ?? "integration-session";
    const persona = "integration";
    vscode.window.showInformationMessage(`🔗 Integration Expert: Starting build loop for "${buildCommand}"`);
    for (let attempt = 1; attempt <= MAX_CORRECTION_LOOPS; attempt++) {
        const header = `Attempt ${attempt}/${MAX_CORRECTION_LOOPS}`;
        // ── Run command ──────────────────────────────────────────────────────────
        const result = await (0, terminal_1.runAndDisplay)(buildCommand, workspaceRoot, persona, sessionId);
        // Persist trace
        const trace = {
            command: buildCommand,
            workingDir: workspaceRoot,
            result,
            timestamp: new Date().toISOString(),
            persona,
        };
        (0, terminal_1.writeExecutionTrace)(workspaceRoot, trace);
        // ── Success path ─────────────────────────────────────────────────────────
        if (result.exitCode === 0) {
            (0, logger_1.updateIntentLogStatus)(workspaceRoot, "approved");
            vscode.window.showInformationMessage(`✅ Integration Expert: Build succeeded on ${header}!`);
            return true;
        }
        // ── Analyze errors ───────────────────────────────────────────────────────
        const errors = analyzeErrors(result.stderr, result.stdout);
        if (errors.length === 0 && attempt < MAX_CORRECTION_LOOPS) {
            // Unknown error — surface to developer and keep retrying
            vscode.window.showWarningMessage(`⚠️ ${header}: Build failed with exit ${result.exitCode}. No known patterns matched. Retrying...`);
            continue;
        }
        // ── Write intent log for the correction ──────────────────────────────────
        const errorSummary = errors
            .map((e) => `• [${e.name}] ${e.rawMatch.slice(0, 80)}`)
            .join("\n");
        const suggestionSummary = errors
            .map((e) => `• ${e.suggestion}`)
            .join("\n");
        (0, logger_1.writeIntentLog)(workspaceRoot, {
            session_id: sessionId,
            persona,
            milestone: `integration:correct:attempt-${attempt}`,
            reasoning: `Build failed with ${errors.length} recognized error(s). Proposing corrections.\n\nErrors:\n${errorSummary}\n\nSuggestions:\n${suggestionSummary}`,
            proposed_changes: errors.map((e) => ({
                file: workspaceRoot,
                description: e.suggestion,
            })),
            validation_hooks: ["terminal_output", "terminal_traces.json"],
        });
        // No-op validation gate (Supabase / validation removed)
        // ── Show correction suggestions in VS Code ───────────────────────────────
        if (attempt < MAX_CORRECTION_LOOPS) {
            const action = await vscode.window.showWarningMessage(`🔧 ${header}: Build failed. Integration Expert found ${errors.length} error(s).\n\n${suggestionSummary}`, { modal: false }, "Retry Build", "Stop");
            if (action !== "Retry Build") {
                vscode.window.showInformationMessage("Integration loop stopped by developer.");
                return false;
            }
        }
    }
    // ── Loop exhausted ───────────────────────────────────────────────────────
    vscode.window.showErrorMessage(`🚫 Integration Expert: Reached maximum ${MAX_CORRECTION_LOOPS} correction attempts. Human intervention required.\n\nCheck ".gemini/terminal_traces.json" for full trace history.`);
    return false;
}
// ─── Load and display last terminal traces ────────────────────────────────────
function getLastTraces(workspaceRoot, limit = 5) {
    const tracePath = path.join(workspaceRoot, ".gemini", "terminal_traces.json");
    if (!fs.existsSync(tracePath)) {
        return [];
    }
    try {
        const all = JSON.parse(fs.readFileSync(tracePath, "utf8"));
        return all.slice(-limit);
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=integration.js.map