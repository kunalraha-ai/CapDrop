import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import * as dotenv from "dotenv";
import { startLocalServer, stopLocalServer } from "./server";
import { runAgentRunner, runSpecGeneration } from "./runner";
import { httpsPost } from "./http";
import { runIntegrationLoop } from "./integration";

// Load environment variables if .env exists in workspace root
function loadEnv() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const envPath = path.join(workspaceFolders[0].uri.fsPath, ".env");
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
      console.log("Environment loaded from workspace .env file");
    }
  }
}

let codeVerifier: string | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log("Antigravity Mini-Agency Orchestrator is now active!");
  loadEnv();

  // Retrieve Supabase URL & Anon Key from env or user settings
  const supabaseUrl = process.env.SUPABASE_URL || vscode.workspace.getConfiguration("antigravityAgency").get<string>("supabaseUrl");
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || vscode.workspace.getConfiguration("antigravityAgency").get<string>("supabaseAnonKey");

  // Initialize Local WebSocket Server
  const wsPort = parseInt(process.env.LOCAL_WS_PORT || "5050", 10);
  startLocalServer(wsPort, context);

  // Register Custom URI Handler for PKCE Auth vscode://antigravity-agency/auth
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      async handleUri(uri: vscode.Uri) {
        if (uri.path === "/auth") {
          const queryParams = new URLSearchParams(uri.query);
          const code = queryParams.get("code");
          if (!code) {
            vscode.window.showErrorMessage("Authentication failed: No authorization code received.");
            return;
          }

          if (!supabaseUrl) {
            vscode.window.showErrorMessage("Authentication failed: SUPABASE_URL is not configured.");
            return;
          }

          if (!codeVerifier) {
            vscode.window.showErrorMessage("Authentication failed: Code verifier is missing or expired.");
            return;
          }

          vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Exchanging authorization code with Supabase...",
              cancellable: false
            },
            async (_progress) => {
              try {
                // Exchange code for token via Supabase Auth API
                const tokenUrl = `${supabaseUrl}/auth/v1/token?grant_type=pkce`;
                const responseText = await httpsPost(
                  tokenUrl,
                  {
                    "Content-Type": "application/json",
                    "apikey": supabaseAnonKey || ""
                  },
                  JSON.stringify({
                    auth_code: code,
                    code_verifier: codeVerifier
                  })
                );

                const data: any = JSON.parse(responseText);
                const sessionToken = data.access_token;
                const refreshToken = data.refresh_token;

                if (!sessionToken) {
                  throw new Error("No access token returned by Supabase.");
                }

                // Store securely in VS Code Extension secrets
                await context.secrets.store("supabaseSessionToken", sessionToken);
                if (refreshToken) {
                  await context.secrets.store("supabaseRefreshToken", refreshToken);
                }

                vscode.window.showInformationMessage("Antigravity Agency: Successfully Authenticated with Supabase!");
                codeVerifier = undefined; // Reset verifier after successful exchange
              } catch (err: any) {
                vscode.window.showErrorMessage(`Authentication exchange failed: ${err.message || err}`);
              }
            }
          );
        }
      }
    })
  );

  // Command 1: Trigger Supabase Auth PKCE Flow
  const loginCmd = vscode.commands.registerCommand("antigravity-agency.login", async () => {
    if (!supabaseUrl) {
      vscode.window.showErrorMessage("Supabase URL is not configured. Please define SUPABASE_URL in your workspace .env.");
      return;
    }

    // Generate PKCE code verifier and code challenge
    codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");

    const authUrl = `${supabaseUrl}/auth/v1/authorize?provider=github&code_challenge_method=s256&code_challenge=${codeChallenge}&redirect_to=vscode://antigravity-agency/auth`;

    vscode.window.showInformationMessage("Opening browser to authenticate with GitHub...");
    vscode.env.openExternal(vscode.Uri.parse(authUrl));
  });

  // Command 2: Spec Generation command
  const generateSpecsCmd = vscode.commands.registerCommand("antigravity-agency.generateSpecs", async () => {
    const requirements = await vscode.window.showInputBox({
      prompt: "Enter the high-level requirements for your application/project",
      placeHolder: "e.g., A blog application with passwordless email auth and post categories..."
    });

    if (!requirements || requirements.trim() === "") {
      vscode.window.showWarningMessage("Spec generation cancelled: Requirements text is required.");
      return;
    }

    await runSpecGeneration(requirements);
  });

  // Command 3: Start Agent session command
  const startAgentCmd = vscode.commands.registerCommand("antigravity-agency.startAgent", async () => {
    vscode.window.showInformationMessage("Starting Local Agent session...");
    await runAgentRunner(context);
  });

  // Command 4: Integration Expert — run build and auto-correct loop
  const runBuildCmd = vscode.commands.registerCommand("antigravity-agency.runBuild", async () => {
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

  context.subscriptions.push(loginCmd, generateSpecsCmd, startAgentCmd, runBuildCmd);
}

export function deactivate() {
  console.log("Deactivating extension...");
  stopLocalServer();
}
