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
exports.executeCommand = executeCommand;
exports.runAndDisplay = runAndDisplay;
exports.writeExecutionTrace = writeExecutionTrace;
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
const logger_1 = require("./logger");
// ─── Allowlist of safe command prefixes ──────────────────────────────────────
// Only the Integration Expert persona may execute terminal commands.
// This guards against arbitrary shell injection from the LLM.
const COMMAND_ALLOWLIST = [
    /^npm\s+(install|run|ci|test|build|audit)/,
    /^npx\s+/,
    /^node\s+/,
    /^tsc(\s|$)/,
    /^git\s+(status|diff|log|add|commit|push|pull|fetch|stash)/,
    /^supabase\s+(db|gen|functions|status|start|stop|migration)/,
    /^cargo\s+(build|test|check|clippy)/,
    /^rustup\s+/,
    /^pnpm\s+/,
    /^yarn\s+/,
    /^echo\s+/,
    /^ls(\s|$)/,
    /^dir(\s|$)/,
    /^cat\s+/,
    /^type\s+/, // Windows equivalent of cat
];
// ─── Security Gate: validate command against allowlist ────────────────────────
function isCommandAllowed(command) {
    const trimmed = command.trim();
    return COMMAND_ALLOWLIST.some((pattern) => pattern.test(trimmed));
}
// ─── Core Terminal Executor ────────────────────────────────────────────────────
/**
 * Executes a shell command securely inside the workspace context.
 * Logs the command and result to intent_log.json before execution.
 * Returns stdout, stderr, exit code, and duration.
 */
async function executeCommand(command, workspaceRoot, persona, sessionId, options) {
    // 1. Security gate: check allowlist
    if (!isCommandAllowed(command)) {
        const errorMsg = `BLOCKED: Command not in Integration Expert allowlist: "${command}"`;
        vscode.window.showErrorMessage(`🚫 Terminal Executor: ${errorMsg}`);
        return {
            stdout: "",
            stderr: errorMsg,
            exitCode: 1,
            durationMs: 0,
        };
    }
    const cwd = options?.cwd ?? workspaceRoot;
    const timeout = options?.timeout ?? 60_000; // 60s default
    // 2. Write intent log BEFORE execution
    (0, logger_1.writeIntentLog)(workspaceRoot, {
        session_id: sessionId,
        persona,
        milestone: `terminal:exec`,
        reasoning: `Integration Expert executing: "${command}" in ${cwd}`,
        proposed_changes: [
            {
                file: cwd,
                description: `Shell command execution: ${command}`,
            },
        ],
        validation_hooks: ["terminal_output"],
    });
    // 3. Execute in workspace context
    const startMs = Date.now();
    return new Promise((resolve) => {
        const proc = cp.exec(command, { cwd, timeout, env: { ...process.env } }, (error, stdout, stderr) => {
            const durationMs = Date.now() - startMs;
            const exitCode = error?.code ?? (error ? 1 : 0);
            const result = {
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode,
                durationMs,
            };
            console.log(`[Terminal] "${command}" → exit ${exitCode} (${durationMs}ms)`);
            if (stderr) {
                console.warn(`[Terminal] stderr: ${stderr.slice(0, 500)}`);
            }
            resolve(result);
        });
        // Enforce timeout
        setTimeout(() => {
            proc.kill();
            resolve({
                stdout: "",
                stderr: `Command timed out after ${timeout}ms: "${command}"`,
                exitCode: 124,
                durationMs: timeout,
            });
        }, timeout + 500);
    });
}
// ─── VS Code Terminal Output Panel ────────────────────────────────────────────
let _outputChannel;
function getOutputChannel() {
    if (!_outputChannel) {
        _outputChannel = vscode.window.createOutputChannel("CapDrop — Agent Terminal");
    }
    return _outputChannel;
}
/**
 * Runs a command and streams output to the VS Code output panel.
 */
async function runAndDisplay(command, workspaceRoot, persona, sessionId) {
    const channel = getOutputChannel();
    channel.show(true);
    channel.appendLine(`\n${"─".repeat(60)}`);
    channel.appendLine(`[${new Date().toISOString()}] (${persona}) $ ${command}`);
    channel.appendLine(`${"─".repeat(60)}`);
    const result = await executeCommand(command, workspaceRoot, persona, sessionId);
    if (result.stdout) {
        channel.appendLine(result.stdout);
    }
    if (result.stderr) {
        channel.appendLine(`[stderr] ${result.stderr}`);
    }
    channel.appendLine(`→ exit: ${result.exitCode} (${result.durationMs}ms)\n`);
    return result;
}
// ─── Trace file writer ────────────────────────────────────────────────────────
/**
 * Persists a full execution trace to .gemini/terminal_traces.json for the
 * Integration Persona to analyze on the next correction loop.
 */
const fs = __importStar(require("fs"));
function writeExecutionTrace(workspaceRoot, trace) {
    const tracePath = path.join(workspaceRoot, ".gemini", "terminal_traces.json");
    const dir = path.dirname(tracePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    let traces = [];
    if (fs.existsSync(tracePath)) {
        try {
            traces = JSON.parse(fs.readFileSync(tracePath, "utf8"));
        }
        catch {
            traces = [];
        }
    }
    traces.push(trace);
    // Keep only the last 50 traces to prevent unbounded growth
    if (traces.length > 50) {
        traces = traces.slice(-50);
    }
    fs.writeFileSync(tracePath, JSON.stringify(traces, null, 2), "utf8");
    console.log(`[Terminal] Trace written to: ${tracePath}`);
}
//# sourceMappingURL=terminal.js.map