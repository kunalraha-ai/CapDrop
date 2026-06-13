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
exports.agentOutputChannel = void 0;
exports.writeIntentLog = writeIntentLog;
exports.updateIntentLogStatus = updateIntentLogStatus;
exports.readLatestPendingEntry = readLatestPendingEntry;
exports.clearIntentLog = clearIntentLog;
exports.isValidationPaused = isValidationPaused;
exports.pauseAtMilestone = pauseAtMilestone;
exports.resumeExecution = resumeExecution;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
exports.agentOutputChannel = vscode.window.createOutputChannel("CapDrop Agent");
// ─── Log file path: .gemini/intent_log.json in workspace root ─────────────────
function getLogPath(workspaceRoot) {
    const dir = path.join(workspaceRoot, ".gemini");
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, "intent_log.json");
}
function readLog(logPath) {
    if (fs.existsSync(logPath)) {
        try {
            return JSON.parse(fs.readFileSync(logPath, "utf8"));
        }
        catch {
            // Corrupted log — reset it
        }
    }
    return { version: "1.0", project_id: "", entries: [] };
}
// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Appends a new agent reasoning entry to intent_log.json.
 * Called BEFORE the agent applies any file writes at a milestone boundary.
 */
function writeIntentLog(workspaceRoot, entry) {
    const logPath = getLogPath(workspaceRoot);
    const log = readLog(logPath);
    const fullEntry = {
        ...entry,
        timestamp: new Date().toISOString(),
        status: "pending",
    };
    log.entries.push(fullEntry);
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2), "utf8");
    console.log(`[IntentLog] Entry written for milestone: "${entry.milestone}"`);
    return logPath;
}
/**
 * Updates the status of the latest pending entry (approved / rejected / override).
 */
function updateIntentLogStatus(workspaceRoot, status, milestoneFilter) {
    const logPath = getLogPath(workspaceRoot);
    const log = readLog(logPath);
    // Find the latest pending entry matching the milestone (or any pending entry)
    const target = [...log.entries]
        .reverse()
        .find((e) => e.status === "pending" &&
        (milestoneFilter ? e.milestone === milestoneFilter : true));
    if (target) {
        target.status = status;
        fs.writeFileSync(logPath, JSON.stringify(log, null, 2), "utf8");
        console.log(`[IntentLog] Entry "${target.milestone}" status → ${status}`);
    }
}
/**
 * Reads the latest pending intent log entry for uploading to the validator.
 */
function readLatestPendingEntry(workspaceRoot) {
    const logPath = getLogPath(workspaceRoot);
    const log = readLog(logPath);
    const pending = log.entries.filter((e) => e.status === "pending");
    return pending.length > 0 ? pending[pending.length - 1] : null;
}
/**
 * Clears all entries from intent_log.json (call at session start).
 */
function clearIntentLog(workspaceRoot) {
    const logPath = getLogPath(workspaceRoot);
    const fresh = { version: "1.0", project_id: "", entries: [] };
    fs.writeFileSync(logPath, JSON.stringify(fresh, null, 2), "utf8");
    console.log("[IntentLog] Log cleared for new session.");
}
// ─── Milestone validation gate ────────────────────────────────────────────────
// Called by runner.ts at sub-task boundaries before committing file writes.
let _validationPaused = false;
let _onResumeCallback;
/**
 * Returns true if execution is currently paused at a validation boundary.
 */
function isValidationPaused() {
    return _validationPaused;
}
/**
 * Pauses execution at a milestone boundary and registers a resume callback.
 */
function pauseAtMilestone(onResume) {
    _validationPaused = true;
    _onResumeCallback = onResume;
    vscode.window.showWarningMessage("⏸ Execution paused at milestone boundary. Awaiting intent validation...", { modal: false });
}
/**
 * Resumes execution from a paused milestone (called after validation result).
 */
function resumeExecution() {
    _validationPaused = false;
    if (_onResumeCallback) {
        _onResumeCallback();
        _onResumeCallback = undefined;
    }
}
//# sourceMappingURL=logger.js.map