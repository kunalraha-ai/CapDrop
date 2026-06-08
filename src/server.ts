import { WebSocketServer, WebSocket } from "ws";
import * as vscode from "vscode";

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
      console.log("WebSocket server is already running. Stopping it first.");
      stopLocalServer();
    }

    wss = new WebSocketServer({ port });
    console.log(`WebSocket Server started on ws://localhost:${port}`);

    wss.on("connection", (ws) => {
      console.log("Tauri Capsule client connected to VS Code Extension");
      activeConnection = ws;

      ws.on("message", async (rawMessage) => {
        try {
          const payload: WebSocketMessage = JSON.parse(rawMessage.toString());
          console.log(`Received WS message: ${payload.event}`, payload.data);

          switch (payload.event) {
            case "persona_shift":
              await handlePersonaShift(payload.data, context);
              break;
            default:
              console.warn(`Unhandled WebSocket event: ${payload.event}`);
          }
        } catch (err: any) {
          console.error("Error parsing WebSocket message:", err);
        }
      });

      ws.on("close", () => {
        console.log("Tauri Capsule client disconnected");
        if (activeConnection === ws) {
          activeConnection = undefined;
        }
      });

      ws.on("error", (error) => {
        console.error("WebSocket client connection error:", error);
      });
    });

    wss.on("error", (error: any) => {
      if (error.code === "EADDRINUSE") {
        vscode.window.showWarningMessage(
          `Local port ${port} is already in use. Ensure no other agent sessions are running.`
        );
      } else {
        console.error("WebSocket server error:", error);
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
  if (activeConnection && activeConnection.readyState === WebSocket.OPEN) {
    const message: WebSocketMessage = {
      event,
      data,
      timestamp: new Date().toISOString()
    };
    activeConnection.send(JSON.stringify(message));
  } else {
    console.log("Cannot send status: No active Tauri connection");
  }
}

// ─── Step 2.3: Dynamic Prompt Injector ────────────────────────────────────────
// Fetches the capsule's system prompt from Supabase, falls back to built-ins.
async function fetchPersonaPromptFromSupabase(
  persona: string,
  sessionToken: string | undefined,
  supabaseUrl: string | undefined,
  supabaseAnonKey: string | undefined
): Promise<string | null> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  try {
    const queryUrl = `${supabaseUrl}/rest/v1/capsules?select=system_prompt&persona=eq.${encodeURIComponent(persona)}&limit=1`;

    const headers: Record<string, string> = {
      "apikey": supabaseAnonKey,
      "Content-Type": "application/json",
    };
    if (sessionToken) {
      headers["Authorization"] = `Bearer ${sessionToken}`;
    }

    // Use GET instead of POST — use native https.get equivalent via a GET wrapper
    const https = require("https");
    const { URL } = require("url");

    const result = await new Promise<string>((resolve, reject) => {
      const url = new URL(queryUrl);
      const options = {
        method: "GET",
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        headers,
      };
      const req = https.request(options, (res: any) => {
        let body = "";
        res.on("data", (chunk: any) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            reject(new Error(`Supabase GET failed: ${res.statusCode} ${body}`));
          }
        });
      });
      req.on("error", reject);
      req.end();
    });

    const rows: Array<{ system_prompt: string }> = JSON.parse(result);
    if (rows && rows.length > 0 && rows[0].system_prompt) {
      console.log(`Loaded system prompt from Supabase for persona: ${persona}`);
      return rows[0].system_prompt;
    }

    return null; // Not found in DB — fall back to built-ins
  } catch (err: any) {
    console.warn(`Could not fetch persona prompt from Supabase: ${err.message}`);
    return null;
  }
}

// ─── Persona Shift Handler ─────────────────────────────────────────────────────
async function handlePersonaShift(
  data: { persona: string; session_id: string },
  context: vscode.ExtensionContext
) {
  const { persona, session_id } = data;

  // Retrieve stored credentials and configuration
  const sessionToken = await context.secrets.get("supabaseSessionToken");
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  // Step 2.3: Try to load dynamic system prompt from Supabase capsules table
  const dynamicPrompt = await fetchPersonaPromptFromSupabase(
    persona,
    sessionToken,
    supabaseUrl,
    supabaseAnonKey
  );

  // Store active persona, session, and the resolved system prompt
  await context.globalState.update("activePersona", persona);
  await context.globalState.update("activeSessionId", session_id);
  if (dynamicPrompt) {
    await context.globalState.update("activePersonaPrompt", dynamicPrompt);
  } else {
    // Clear stored prompt so runner falls back to built-in prompts
    await context.globalState.update("activePersonaPrompt", undefined);
  }

  const sourceLabel = dynamicPrompt ? "Supabase" : "built-in";
  vscode.window.showInformationMessage(
    `🎭 Persona shifted to: ${persona.toUpperCase()} (${sourceLabel} prompt | Session: ${session_id})`
  );

  // Send acknowledgment back to Tauri floating window
  sendStatusToTauri("persona_ack", {
    persona,
    session_id,
    status: "active",
    source: sourceLabel,
  });

  // Trigger the agent runner to re-initialize with the new persona context
  vscode.commands.executeCommand("antigravity-agency.startAgent");
}
