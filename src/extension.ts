import * as vscode from "vscode";
import { startLocalServer, stopLocalServer } from "./server";
import { runAgentRunner } from "./runner";
import { runIntegrationLoop } from "./integration";
import { openCapsuleLibrary } from "./library";
import { agentOutputChannel } from "./logger";

export function activate(context: vscode.ExtensionContext) {
  agentOutputChannel.appendLine("CapDrop activated.");
  context.subscriptions.push(agentOutputChannel);
  console.log("CapDrop is now active!");

  // Load initial active team
  let activeTeam = context.globalState.get<string[]>("activeTeam");
  if (!activeTeam || activeTeam.length === 0) {
    activeTeam = ["ui_ux", "backend", "qa", "security", "integration"];
    context.globalState.update("activeTeam", activeTeam);
  }

  // Initialize Local WebSocket Server
  const wsPort = parseInt(process.env.LOCAL_WS_PORT || "5050", 10);
  startLocalServer(wsPort, context);

  // Command 3: Start Agent session command
  const startAgentCmd = vscode.commands.registerCommand("capdrop.startAgent", async () => {
    vscode.window.showInformationMessage("Starting Local Agent session...");
    await runAgentRunner(context);
  });

  // Command 4: Integration Expert — run build and auto-correct loop
  const runBuildCmd = vscode.commands.registerCommand("capdrop.runBuild", async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      vscode.window.showErrorMessage("Open a workspace first to run the Integration Expert.");
      return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    const buildCommand = await vscode.window.showInputBox({
      prompt: "Integration Expert: Enter the build/run command",
      placeHolder: "e.g., npm run build  or  cargo build  or  npm test",
      value: "npm run compile",
    });

    if (!buildCommand?.trim()) {
      vscode.window.showWarningMessage("Run Build cancelled: No command entered.");
      return;
    }

    await runIntegrationLoop(context, workspaceRoot, buildCommand.trim());
  });

  // Command 5: Open Capsule Library webview
  const openLibraryCmd = vscode.commands.registerCommand("capdrop.openCapsuleLibrary", () => {
    openCapsuleLibrary(context);
  });

  context.subscriptions.push(startAgentCmd, runBuildCmd, openLibraryCmd);
}

export function deactivate() {
  console.log("Deactivating extension...");
  stopLocalServer();
}
