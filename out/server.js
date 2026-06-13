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
exports.startLocalServer = startLocalServer;
exports.stopLocalServer = stopLocalServer;
exports.sendStatusToTauri = sendStatusToTauri;
exports.broadcastActiveTeam = broadcastActiveTeam;
const ws_1 = require("ws");
const vscode = __importStar(require("vscode"));
const prompts_1 = require("./prompts");
const logger_1 = require("./logger");
// WebSocket Server State
let wss;
let activeConnection;
// ─── Start Local WebSocket Server ─────────────────────────────────────────────
function startLocalServer(port, context) {
    try {
        if (wss) {
            logger_1.agentOutputChannel.appendLine("[WebSocket Server] WebSocket server is already running. Stopping it first.");
            stopLocalServer();
        }
        wss = new ws_1.WebSocketServer({ port });
        logger_1.agentOutputChannel.appendLine(`[WebSocket Server] WebSocket Server started on ws://localhost:${port}`);
        wss.on("connection", (ws) => {
            logger_1.agentOutputChannel.appendLine("[WebSocket Server] Tauri Capsule client connected to VS Code Extension");
            activeConnection = ws;
            // Sync active team on connection
            const activeTeamIds = context.globalState.get("activeTeam") || ["ui_ux", "backend", "qa", "security", "integration"];
            const activeTeamObjects = activeTeamIds.map(id => prompts_1.ALL_PERSONAS.find(p => p.id === id)).filter(Boolean);
            ws.send(JSON.stringify({
                event: "team_sync",
                data: { team: activeTeamObjects },
                timestamp: new Date().toISOString()
            }));
            ws.on("message", async (rawMessage) => {
                try {
                    const payload = JSON.parse(rawMessage.toString());
                    logger_1.agentOutputChannel.appendLine(`[WebSocket Server] Received WS message: ${payload.event} | Data: ${JSON.stringify(payload.data)}`);
                    switch (payload.event) {
                        case "persona_shift":
                            logger_1.agentOutputChannel.appendLine(`[WebSocket Server] Shifting to persona: ${payload.data.persona}`);
                            await handlePersonaShift(payload.data, context);
                            break;
                        case "open_library":
                            logger_1.agentOutputChannel.appendLine("[WebSocket Server] Execution triggered for open_library command");
                            try {
                                await vscode.commands.executeCommand("capdrop.openCapsuleLibrary");
                                logger_1.agentOutputChannel.appendLine("[WebSocket Server] openCapsuleLibrary command executed successfully");
                            }
                            catch (cmdErr) {
                                logger_1.agentOutputChannel.appendLine(`[WebSocket Server] Error executing openCapsuleLibrary command: ${cmdErr.message || cmdErr}`);
                                vscode.window.showErrorMessage(`Failed to open Capsule Library: ${cmdErr.message || cmdErr}`);
                            }
                            break;
                        default:
                            logger_1.agentOutputChannel.appendLine(`[WebSocket Server] Unhandled event: ${payload.event}`);
                    }
                }
                catch (err) {
                    logger_1.agentOutputChannel.appendLine(`[WebSocket Server] Error parsing WS message: ${err.message || err}`);
                }
            });
            ws.on("close", () => {
                logger_1.agentOutputChannel.appendLine("[WebSocket Server] Tauri Capsule client disconnected");
                if (activeConnection === ws) {
                    activeConnection = undefined;
                }
            });
            ws.on("error", (error) => {
                logger_1.agentOutputChannel.appendLine(`[WebSocket Server] WebSocket client connection error: ${error.message || error}`);
            });
        });
        wss.on("error", (error) => {
            if (error.code === "EADDRINUSE") {
                logger_1.agentOutputChannel.appendLine(`[WebSocket Server] Error: Port ${port} is already in use`);
                vscode.window.showWarningMessage(`Local port ${port} is already in use. Ensure no other agent sessions are running.`);
            }
            else {
                logger_1.agentOutputChannel.appendLine(`[WebSocket Server] Server error: ${error.message || error}`);
            }
        });
    }
    catch (err) {
        console.error("Failed to start WebSocket server:", err);
    }
}
function stopLocalServer() {
    if (wss) {
        wss.close();
        wss = undefined;
        activeConnection = undefined;
        console.log("WebSocket Server stopped");
    }
}
function sendStatusToTauri(event, data) {
    if (wss) {
        const message = JSON.stringify({
            event,
            data,
            timestamp: new Date().toISOString()
        });
        for (const client of wss.clients) {
            if (client.readyState === ws_1.WebSocket.OPEN) {
                client.send(message);
            }
        }
    }
    else {
        console.log("Cannot send status: No running WebSocket server");
    }
}
function broadcastActiveTeam(team) {
    if (wss) {
        const message = JSON.stringify({
            event: "team_sync",
            data: { team },
            timestamp: new Date().toISOString()
        });
        for (const client of wss.clients) {
            if (client.readyState === ws_1.WebSocket.OPEN) {
                client.send(message);
            }
        }
    }
    else {
        console.log("Cannot broadcast active team: No running WebSocket server");
    }
}
// ─── Persona Shift Handler ─────────────────────────────────────────────────────
async function handlePersonaShift(data, context) {
    const { persona, session_id } = data;
    // Store active persona and session
    await context.globalState.update("activePersona", persona);
    await context.globalState.update("activeSessionId", session_id);
    await context.globalState.update("activePersonaPrompt", undefined);
    vscode.window.showInformationMessage(`🎭 Persona shifted to: ${persona.toUpperCase()} (built-in prompt | Session: ${session_id})`);
    // Send acknowledgment back to Tauri floating window
    sendStatusToTauri("persona_ack", {
        persona,
        session_id,
        status: "active",
        source: "built-in",
    });
    // Trigger the agent runner to re-initialize with the new persona context
    vscode.commands.executeCommand("capdrop.startAgent");
}
//# sourceMappingURL=server.js.map