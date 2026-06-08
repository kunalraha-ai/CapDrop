const WebSocket = require("ws");
const port = process.env.LOCAL_WS_PORT || 5050;
const ws = new WebSocket(`ws://localhost:${port}`);

ws.on("open", () => {
  console.log(`Connected to Extension WebSocket Server on port ${port}!`);
  const payload = {
    event: "persona_shift",
    data: {
      persona: "backend",
      session_id: "test-session-123"
    },
    timestamp: new Date().toISOString()
  };
  ws.send(JSON.stringify(payload));
  setTimeout(() => {
    ws.close();
  }, 1000);
});

ws.on("error", (err) => {
  console.error("WebSocket Connection Error:", err.message);
});
