import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { httpsPost } from "./http";
import {
  readLatestPendingEntry,
  updateIntentLogStatus,
  pauseAtMilestone,
  resumeExecution,
} from "./logger";

// ─── Validation result types ──────────────────────────────────────────────────

export interface ValidationResult {
  status: "approved" | "warning";
  mismatches: string[];
  recommendation: string;
}

// ─── Core Validator ───────────────────────────────────────────────────────────

/**
 * Calls the Supabase intent-validator edge function with the pending intent log
 * and the local spec files. Blocks execution until a verdict is received.
 *
 * Returns:
 *  - "approved":  Execution may continue.
 *  - "override":  User manually approved despite warning.
 *  - "rejected":  Execution blocked; agent should abort/replan.
 */
export async function runValidationGate(
  context: vscode.ExtensionContext,
  workspaceRoot: string
): Promise<"approved" | "override" | "rejected"> {

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const sessionToken = await context.secrets.get("supabaseSessionToken");
  const projectId = context.globalState.get<string>("activeProjectId") ?? "default-project";

  if (!supabaseUrl) {
    vscode.window.showWarningMessage(
      "Intent Validator: SUPABASE_URL not configured. Skipping validation and proceeding."
    );
    return "approved";
  }

  // Read pending intent log entry
  const entry = readLatestPendingEntry(workspaceRoot);
  if (!entry) {
    console.log("[Validator] No pending intent log entry found. Proceeding.");
    return "approved";
  }

  // Read local spec files
  const prdPath = path.join(workspaceRoot, "PRD.md");
  const trdPath = path.join(workspaceRoot, "TRD.md");

  if (!fs.existsSync(prdPath) || !fs.existsSync(trdPath)) {
    vscode.window.showWarningMessage(
      "Intent Validator: PRD.md or TRD.md not found. Skipping validation."
    );
    return "approved";
  }

  const prd = fs.readFileSync(prdPath, "utf8");
  const trd = fs.readFileSync(trdPath, "utf8");

  // ── Send to cloud validator ──────────────────────────────────────────────
  const validatorUrl = `${supabaseUrl}/functions/v1/intent-validator`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "apikey": supabaseAnonKey ?? "",
  };
  if (sessionToken) {
    headers["Authorization"] = `Bearer ${sessionToken}`;
  }

  let result: ValidationResult;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "🔍 Validating agent intent against PRD/TRD...",
      cancellable: false,
    },
    async () => {
      try {
        const responseText = await httpsPost(
          validatorUrl,
          headers,
          JSON.stringify({
            project_id: projectId,
            intent_log: entry,
            specs: { prd, trd },
          })
        );
        result = JSON.parse(responseText);
      } catch (err: any) {
        vscode.window.showWarningMessage(
          `Intent Validator unreachable: ${err.message}. Proceeding with caution.`
        );
        result = { status: "approved", mismatches: [], recommendation: "" };
      }
    }
  );

  result = result!;

  // ── Handle approved ──────────────────────────────────────────────────────
  if (result.status === "approved") {
    updateIntentLogStatus(workspaceRoot, "approved", entry.milestone);
    vscode.window.showInformationMessage(
      `✅ Intent Validated: "${entry.milestone}" is aligned with PRD/TRD. Continuing...`
    );
    return "approved";
  }

  // ── Handle warning — pause and prompt developer ──────────────────────────
  const mismatchDetail = result.mismatches.join("\n• ");

  return await new Promise<"approved" | "override" | "rejected">((resolve) => {
    pauseAtMilestone(() => resolve("approved"));

    vscode.window
      .showWarningMessage(
        `⚠️ Intent Mismatch Detected: "${entry.milestone}"\n\n` +
          `• ${mismatchDetail}\n\nRecommendation: ${result.recommendation}`,
        { modal: true },
        "Override & Continue",
        "Auto-Replan",
        "Abort"
      )
      .then((choice) => {
        switch (choice) {
          case "Override & Continue":
            updateIntentLogStatus(workspaceRoot, "override", entry.milestone);
            vscode.window.showInformationMessage(
              "⚡ Override applied. Continuing agent execution."
            );
            resumeExecution();
            resolve("override");
            break;

          case "Auto-Replan":
            updateIntentLogStatus(workspaceRoot, "rejected", entry.milestone);
            vscode.window.showInformationMessage(
              "♻️ Replan requested. Agent will restart milestone planning."
            );
            resolve("rejected");
            break;

          case "Abort":
          default:
            updateIntentLogStatus(workspaceRoot, "rejected", entry.milestone);
            vscode.window.showErrorMessage(
              "🚫 Agent execution aborted by developer."
            );
            resolve("rejected");
            break;
        }
      });
  });
}
