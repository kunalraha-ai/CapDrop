import { WebSocketServer, WebSocket } from "ws";
import * as vscode from "vscode";
import { ALL_PERSONAS } from "./prompts";
import { agentOutputChannel } from "./logger";

// WebSocket Server State
let wss: WebSocketServer | undefined;
let activeConnection: WebSocket | undefined;

export interface WebSocketMessage<T = any> {
  event: string;
  data: T;
  timestamp: string;
}

// ─── Start Local WebSocket Server ─────────────────────────────────────────────
export function startLocalServer(port: number, context: vscode.ExtensionContext) {
  try {
    if (wss) {
      agentOutputChannel.appendLine("[WebSocket Server] WebSocket server is already running. Stopping it first.");
      stopLocalServer();
    }

    wss = new WebSocketServer({ port });
    agentOutputChannel.appendLine(`[WebSocket Server] WebSocket Server started on ws://localhost:${port}`);

    wss.on("connection", (ws) => {
      agentOutputChannel.appendLine("[WebSocket Server] Tauri Capsule client connected to VS Code Extension");
      activeConnection = ws;

      // Sync active team on connection
      const activeTeamIds = context.globalState.get<string[]>("activeTeam") || ["ui_ux", "backend", "qa", "security", "integration"];
      const activeTeamObjects = activeTeamIds.map(id => ALL_PERSONAS.find(p => p.id === id)).filter(Boolean);
      ws.send(JSON.stringify({
        event: "team_sync",
        data: { team: activeTeamObjects },
        timestamp: new Date().toISOString()
      }));

      ws.on("message", async (rawMessage) => {
        try {
          const payload: WebSocketMessage = JSON.parse(rawMessage.toString());
          agentOutputChannel.appendLine(`[WebSocket Server] Received WS message: ${payload.event} | Data: ${JSON.stringify(payload.data)}`);

          switch (payload.event) {
            case "persona_shift":
              agentOutputChannel.appendLine(`[WebSocket Server] Shifting to persona: ${payload.data.persona}`);
              await handlePersonaShift(payload.data, context);
              break;
            case "open_library":
              agentOutputChannel.appendLine("[WebSocket Server] Execution triggered for open_library command");
              try {
                await vscode.commands.executeCommand("capdrop.openCapsuleLibrary");
                agentOutputChannel.appendLine("[WebSocket Server] openCapsuleLibrary command executed successfully");
              } catch (cmdErr: any) {
                agentOutputChannel.appendLine(`[WebSocket Server] Error executing openCapsuleLibrary command: ${cmdErr.message || cmdErr}`);
                vscode.window.showErrorMessage(`Failed to open Capsule Library: ${cmdErr.message || cmdErr}`);
              }
              break;
            default:
              agentOutputChannel.appendLine(`[WebSocket Server] Unhandled event: ${payload.event}`);
          }
        } catch (err: any) {
          agentOutputChannel.appendLine(`[WebSocket Server] Error parsing WS message: ${err.message || err}`);
        }
      });

      ws.on("close", () => {
        agentOutputChannel.appendLine("[WebSocket Server] Tauri Capsule client disconnected");
        if (activeConnection === ws) {
          activeConnection = undefined;
        }
      });

      ws.on("error", (error) => {
        agentOutputChannel.appendLine(`[WebSocket Server] WebSocket client connection error: ${error.message || error}`);
      });
    });

    wss.on("error", (error: any) => {
      if (error.code === "EADDRINUSE") {
        agentOutputChannel.appendLine(`[WebSocket Server] Error: Port ${port} is already in use`);
        vscode.window.showWarningMessage(
          `Local port ${port} is already in use. Ensure no other agent sessions are running.`
        );
      } else {
        agentOutputChannel.appendLine(`[WebSocket Server] Server error: ${error.message || error}`);
      }
    });

  } catch (err: any) {
    console.error("Failed to start WebSocket server:", err);
  }
}

export function stopLocalServer() {
  if (wss) {
    wss.close();
    wss = undefined;
    activeConnection = undefined;
    console.log("WebSocket Server stopped");
  }
}

export function sendStatusToTauri(event: string, data: any) {
  if (wss) {
    const message = JSON.stringify({
      event,
      data,
      timestamp: new Date().toISOString()
    });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  } else {
    console.log("Cannot send status: No running WebSocket server");
  }
}

export function broadcastActiveTeam(team: any[]) {
  if (wss) {
    const message = JSON.stringify({
      event: "team_sync",
      data: { team },
      timestamp: new Date().toISOString()
    });
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  } else {
    console.log("Cannot broadcast active team: No running WebSocket server");
  }
}

// ─── Persona Shift Handler ─────────────────────────────────────────────────────
async function handlePersonaShift(
  data: { persona: string; session_id: string },
  context: vscode.ExtensionContext
) {
  const { persona, session_id } = data;

  // Store active persona and session
  await context.globalState.update("activePersona", persona);
  await context.globalState.update("activeSessionId", session_id);
  await context.globalState.update("activePersonaPrompt", undefined);

  vscode.window.showInformationMessage(
    `🎭 Persona shifted to: ${persona.toUpperCase()} (built-in prompt | Session: ${session_id})`
  );

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
