import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProposedChange {
  file: string;
  description: string;
  lines?: { start: number; end: number };
  apiEndpoints?: string[];
  schemaChanges?: string[];
}

export interface IntentLogEntry {
  timestamp: string;
  session_id: string;
  persona: string;
  milestone: string;
  reasoning: string;
  proposed_changes: ProposedChange[];
  validation_hooks: string[];
  status: "pending" | "approved" | "rejected" | "override";
}

export interface IntentLog {
  version: "1.0";
  project_id: string;
  entries: IntentLogEntry[];
}

// ─── Log file path: .gemini/intent_log.json in workspace root ─────────────────
function getLogPath(workspaceRoot: string): string {
  const dir = path.join(workspaceRoot, ".gemini");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, "intent_log.json");
}

function readLog(logPath: string): IntentLog {
  if (fs.existsSync(logPath)) {
    try {
      return JSON.parse(fs.readFileSync(logPath, "utf8")) as IntentLog;
    } catch {
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
export function writeIntentLog(
  workspaceRoot: string,
  entry: Omit<IntentLogEntry, "timestamp" | "status">
): string {
  const logPath = getLogPath(workspaceRoot);
  const log = readLog(logPath);

  const fullEntry: IntentLogEntry = {
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
export function updateIntentLogStatus(
  workspaceRoot: string,
  status: IntentLogEntry["status"],
  milestoneFilter?: string
): void {
  const logPath = getLogPath(workspaceRoot);
  const log = readLog(logPath);

  // Find the latest pending entry matching the milestone (or any pending entry)
  const target = [...log.entries]
    .reverse()
    .find(
      (e) =>
        e.status === "pending" &&
        (milestoneFilter ? e.milestone === milestoneFilter : true)
    );

  if (target) {
    target.status = status;
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2), "utf8");
    console.log(`[IntentLog] Entry "${target.milestone}" status → ${status}`);
  }
}

/**
 * Reads the latest pending intent log entry for uploading to the validator.
 */
export function readLatestPendingEntry(
  workspaceRoot: string
): IntentLogEntry | null {
  const logPath = getLogPath(workspaceRoot);
  const log = readLog(logPath);
  const pending = log.entries.filter((e) => e.status === "pending");
  return pending.length > 0 ? pending[pending.length - 1] : null;
}

/**
 * Clears all entries from intent_log.json (call at session start).
 */
export function clearIntentLog(workspaceRoot: string): void {
  const logPath = getLogPath(workspaceRoot);
  const fresh: IntentLog = { version: "1.0", project_id: "", entries: [] };
  fs.writeFileSync(logPath, JSON.stringify(fresh, null, 2), "utf8");
  console.log("[IntentLog] Log cleared for new session.");
}

// ─── Milestone validation gate ────────────────────────────────────────────────
// Called by runner.ts at sub-task boundaries before committing file writes.

let _validationPaused = false;
let _onResumeCallback: (() => void) | undefined;

/**
 * Returns true if execution is currently paused at a validation boundary.
 */
export function isValidationPaused(): boolean {
  return _validationPaused;
}

/**
 * Pauses execution at a milestone boundary and registers a resume callback.
 */
export function pauseAtMilestone(onResume: () => void): void {
  _validationPaused = true;
  _onResumeCallback = onResume;
  vscode.window.showWarningMessage(
    "⏸ Execution paused at milestone boundary. Awaiting intent validation...",
    { modal: false }
  );
}

/**
 * Resumes execution from a paused milestone (called after validation result).
 */
export function resumeExecution(): void {
  _validationPaused = false;
  if (_onResumeCallback) {
    _onResumeCallback();
    _onResumeCallback = undefined;
  }
}
