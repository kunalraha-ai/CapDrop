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
exports.openCapsuleLibrary = openCapsuleLibrary;
const vscode = __importStar(require("vscode"));
const prompts_1 = require("./prompts");
const server_1 = require("./server");
const logger_1 = require("./logger");
let currentPanel;
function openCapsuleLibrary(context) {
    try {
        logger_1.agentOutputChannel.appendLine("[Capsule Library] openCapsuleLibrary invoked");
        if (currentPanel) {
            logger_1.agentOutputChannel.appendLine("[Capsule Library] Revealing existing webview panel");
            currentPanel.reveal(vscode.ViewColumn.One);
            return;
        }
        logger_1.agentOutputChannel.appendLine("[Capsule Library] Creating new webview panel");
        currentPanel = vscode.window.createWebviewPanel("capsuleLibrary", "Capsule Library", vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });
        currentPanel.onDidDispose(() => {
            logger_1.agentOutputChannel.appendLine("[Capsule Library] Webview panel disposed");
            currentPanel = undefined;
        }, null, context.subscriptions);
        // Update HTML content
        updateWebviewContent(context);
        // Handle messages from the webview
        currentPanel.webview.onDidReceiveMessage(async (message) => {
            try {
                logger_1.agentOutputChannel.appendLine(`[Capsule Library] Received command from webview: ${message.command}`);
                switch (message.command) {
                    case "updateTeam":
                        const teamIds = message.teamIds;
                        logger_1.agentOutputChannel.appendLine(`[Capsule Library] Updating active team to: ${JSON.stringify(teamIds)}`);
                        await context.globalState.update("activeTeam", teamIds);
                        // Re-resolve team objects to broadcast to Tauri
                        const teamObjects = teamIds
                            .map((id) => prompts_1.ALL_PERSONAS.find((p) => p.id === id))
                            .filter((p) => !!p);
                        (0, server_1.broadcastActiveTeam)(teamObjects);
                        // Re-render webview to sync status
                        updateWebviewContent(context);
                        break;
                }
            }
            catch (msgErr) {
                logger_1.agentOutputChannel.appendLine(`[Capsule Library] Error handling message from webview: ${msgErr.message || msgErr}`);
            }
        }, undefined, context.subscriptions);
    }
    catch (err) {
        logger_1.agentOutputChannel.appendLine(`[Capsule Library] Error opening Capsule Library: ${err.message || err}`);
        vscode.window.showErrorMessage(`Error opening Capsule Library: ${err.message || err}`);
    }
}
function updateWebviewContent(context) {
    try {
        if (!currentPanel) {
            logger_1.agentOutputChannel.appendLine("[Capsule Library] updateWebviewContent called but currentPanel is undefined");
            return;
        }
        logger_1.agentOutputChannel.appendLine("[Capsule Library] Updating webview HTML content");
        const activeTeamIds = context.globalState.get("activeTeam") || [
            "ui_ux",
            "backend",
            "qa",
            "security",
            "integration",
        ];
        // Resolve active team objects
        const activeTeam = activeTeamIds
            .map((id) => prompts_1.ALL_PERSONAS.find((p) => p.id === id))
            .filter((p) => !!p);
        // Resolve remaining library personas
        const libraryPersonas = prompts_1.ALL_PERSONAS.filter((p) => !activeTeamIds.includes(p.id));
        currentPanel.webview.html = getWebviewHtml(activeTeam, libraryPersonas);
    }
    catch (err) {
        logger_1.agentOutputChannel.appendLine(`[Capsule Library] Error rendering webview content: ${err.message || err}`);
    }
}
function getWebviewHtml(activeTeam, libraryPersonas) {
    const activeCardsHtml = activeTeam
        .map((p, index) => `
    <div class="card" draggable="true" data-id="${p.id}" data-index="${index}">
      <div class="card-glow" style="background: radial-gradient(circle at 50% 50%, ${p.accent}15, transparent 60%); border-color: ${p.accent}40;"></div>
      <span class="card-icon" style="background: ${p.accent}15; color: ${p.accent};">${p.icon}</span>
      <div class="card-info">
        <div class="card-header-row">
          <span class="card-name">${p.label}</span>
          <span class="active-badge" style="background: ${p.accent}20; color: ${p.accent};">Active Slot ${index + 1}</span>
        </div>
        <span class="card-desc">${p.description}</span>
      </div>
      <div class="card-actions">
        <button class="action-btn" title="Move Up" onclick="moveUp(${index})" ${index === 0 ? "disabled" : ""}>▲</button>
        <button class="action-btn" title="Move Down" onclick="moveDown(${index})" ${index === activeTeam.length - 1 ? "disabled" : ""}>▼</button>
        <button class="action-btn remove-btn" title="Remove from Active Team" onclick="removePersona('${p.id}')">✕</button>
      </div>
    </div>
  `)
        .join("");
    const libraryCardsHtml = libraryPersonas.length === 0
        ? `<div class="empty-state">All personas are currently active in your team.</div>`
        : libraryPersonas
            .map((p) => `
    <div class="card library-card" data-id="${p.id}">
      <span class="card-icon" style="background: ${p.accent}15; color: ${p.accent};">${p.icon}</span>
      <div class="card-info">
        <span class="card-name">${p.label}</span>
        <span class="card-desc">${p.description}</span>
      </div>
      <div class="card-actions">
        <button class="add-btn" style="background: ${p.accent}20; border-color: ${p.accent}40; color: ${p.accent};" onclick="addPersona('${p.id}')">➕ Add to Team</button>
      </div>
    </div>
  `)
            .join("");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Capsule Library</title>
  <style>
    :root {
      --bg-dark: #0a0b10;
      --bg-card: rgba(18, 19, 26, 0.6);
      --bg-input: #1b1d28;
      --border-color: rgba(255, 255, 255, 0.08);
      --text-main: #f0f1f5;
      --text-muted: #8e92a2;
      --font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
    }

    body {
      background-color: var(--bg-dark);
      color: var(--text-main);
      font-family: var(--font-family);
      margin: 0;
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
      box-sizing: border-box;
    }

    .container {
      width: 100%;
      max-width: 800px;
      display: flex;
      flex-direction: column;
      gap: 32px;
    }

    header {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .title {
      font-size: 28px;
      font-weight: 700;
      margin: 0;
      background: linear-gradient(135deg, #fff, var(--text-muted));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .subtitle {
      font-size: 14px;
      color: var(--text-muted);
      margin: 0;
    }

    section {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .section-title {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .slot-counter {
      font-size: 12px;
      color: var(--text-muted);
      background: var(--bg-input);
      padding: 4px 10px;
      border-radius: 20px;
      border: 1px solid var(--border-color);
    }

    .card-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .card {
      position: relative;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 16px;
      display: flex;
      align-items: center;
      gap: 16px;
      backdrop-filter: blur(10px);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      cursor: grab;
      user-select: none;
      overflow: hidden;
    }

    .card:active {
      cursor: grabbing;
    }

    .card:hover {
      border-color: rgba(255, 255, 255, 0.15);
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.4);
    }

    .card-glow {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      border-radius: 12px;
      border: 1px solid transparent;
      pointer-events: none;
      z-index: 0;
    }

    .card-icon {
      width: 48px;
      height: 48px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      z-index: 1;
      flex-shrink: 0;
    }

    .card-info {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex-grow: 1;
      z-index: 1;
    }

    .card-header-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .card-name {
      font-weight: 600;
      font-size: 16px;
    }

    .active-badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 6px;
      font-weight: 500;
    }

    .card-desc {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.4;
    }

    .card-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      z-index: 1;
      flex-shrink: 0;
    }

    .action-btn {
      background: var(--bg-input);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 12px;
      transition: all 0.15s ease;
    }

    .action-btn:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .action-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    .remove-btn {
      color: #ff5555;
      background: rgba(255, 85, 85, 0.1);
      border-color: rgba(255, 85, 85, 0.2);
    }

    .remove-btn:hover {
      background: rgba(255, 85, 85, 0.2) !important;
      border-color: rgba(255, 85, 85, 0.4) !important;
    }

    .library-card {
      cursor: default;
    }

    .add-btn {
      border: 1px solid transparent;
      padding: 8px 16px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .add-btn:hover {
      transform: scale(1.03);
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    }

    .empty-state {
      background: rgba(255, 255, 255, 0.02);
      border: 1px dashed var(--border-color);
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      color: var(--text-muted);
      font-size: 14px;
    }

    .card.drag-over {
      border-color: #3b82f6;
      background: rgba(59, 130, 246, 0.05);
      transform: scale(0.99);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1 class="title">Capsule Library</h1>
      <p class="subtitle">Customize which developer capsules are active in your floating Tauri widget app and reorder them for sequential handoffs.</p>
    </header>

    <section>
      <h2 class="section-title">
        <span>Active Team</span>
        <span class="slot-counter">${activeTeam.length} Active</span>
      </h2>
      <div class="card-list" id="active-list">
        ${activeCardsHtml}
      </div>
    </section>

    <section>
      <h2 class="section-title">Available Library</h2>
      <div class="card-list">
        ${libraryCardsHtml}
      </div>
    </section>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    
    // Active team IDs array
    let teamIds = [${activeTeam.map((p) => `"${p.id}"`).join(", ")}];

    function updateTeam(newIds) {
      vscode.postMessage({
        command: 'updateTeam',
        teamIds: newIds
      });
    }

    function removePersona(id) {
      const filtered = teamIds.filter(x => x !== id);
      updateTeam(filtered);
    }

    function addPersona(id) {
      if (!teamIds.includes(id)) {
        updateTeam([...teamIds, id]);
      }
    }

    function moveUp(index) {
      if (index > 0) {
        const newIds = [...teamIds];
        const temp = newIds[index];
        newIds[index] = newIds[index - 1];
        newIds[index - 1] = temp;
        updateTeam(newIds);
      }
    }

    function moveDown(index) {
      if (index < teamIds.length - 1) {
        const newIds = [...teamIds];
        const temp = newIds[index];
        newIds[index] = newIds[index + 1];
        newIds[index + 1] = temp;
        updateTeam(newIds);
      }
    }

    // HTML5 Drag and Drop implementation
    let dragSrcEl = null;

    function handleDragStart(e) {
      this.style.opacity = '0.4';
      dragSrcEl = this;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', this.getAttribute('data-id'));
    }

    function handleDragOver(e) {
      if (e.preventDefault) {
        e.preventDefault();
      }
      e.dataTransfer.dropEffect = 'move';
      return false;
    }

    function handleDragEnter(e) {
      this.classList.add('drag-over');
    }

    function handleDragLeave(e) {
      this.classList.remove('drag-over');
    }

    function handleDrop(e) {
      e.stopPropagation();
      e.preventDefault();
      
      const targetId = this.getAttribute('data-id');
      const sourceId = e.dataTransfer.getData('text/plain');

      if (sourceId !== targetId) {
        const sourceIndex = teamIds.indexOf(sourceId);
        const targetIndex = teamIds.indexOf(targetId);

        if (sourceIndex !== -1 && targetIndex !== -1) {
          const newIds = [...teamIds];
          // Remove source item and insert at target
          newIds.splice(sourceIndex, 1);
          newIds.splice(targetIndex, 0, sourceId);
          updateTeam(newIds);
        }
      }
      return false;
    }

    function handleDragEnd(e) {
      this.style.opacity = '1';
      const cards = document.querySelectorAll('#active-list .card');
      cards.forEach(card => {
        card.classList.remove('drag-over');
      });
    }

    // Bind drag and drop listeners
    const cards = document.querySelectorAll('#active-list .card');
    cards.forEach(card => {
      card.addEventListener('dragstart', handleDragStart, false);
      card.addEventListener('dragenter', handleDragEnter, false);
      card.addEventListener('dragover', handleDragOver, false);
      card.addEventListener('dragleave', handleDragLeave, false);
      card.addEventListener('drop', handleDrop, false);
      card.addEventListener('dragend', handleDragEnd, false);
    });
  </script>
</body>
</html>`;
}
//# sourceMappingURL=library.js.map