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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const server_1 = require("./server");
const runner_1 = require("./runner");
const integration_1 = require("./integration");
const library_1 = require("./library");
const logger_1 = require("./logger");
function activate(context) {
    logger_1.agentOutputChannel.appendLine("CapDrop activated.");
    context.subscriptions.push(logger_1.agentOutputChannel);
    console.log("CapDrop is now active!");
    // Load initial active team
    let activeTeam = context.globalState.get("activeTeam");
    if (!activeTeam || activeTeam.length === 0) {
        activeTeam = ["ui_ux", "backend", "qa", "security", "integration"];
        context.globalState.update("activeTeam", activeTeam);
    }
    // Initialize Local WebSocket Server
    const wsPort = parseInt(process.env.LOCAL_WS_PORT || "5050", 10);
    (0, server_1.startLocalServer)(wsPort, context);
    // Command 3: Start Agent session command
    const startAgentCmd = vscode.commands.registerCommand("capdrop.startAgent", async () => {
        vscode.window.showInformationMessage("Starting Local Agent session...");
        await (0, runner_1.runAgentRunner)(context);
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
        await (0, integration_1.runIntegrationLoop)(context, workspaceRoot, buildCommand.trim());
    });
    // Command 5: Open Capsule Library webview
    const openLibraryCmd = vscode.commands.registerCommand("capdrop.openCapsuleLibrary", () => {
        (0, library_1.openCapsuleLibrary)(context);
    });
    context.subscriptions.push(startAgentCmd, runBuildCmd, openLibraryCmd);
}
function deactivate() {
    console.log("Deactivating extension...");
    (0, server_1.stopLocalServer)();
}
//# sourceMappingURL=extension.js.map