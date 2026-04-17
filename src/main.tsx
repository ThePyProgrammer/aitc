import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import "./styles/theme.css";

// ── Force-lock webview zoom to 1.0 ──
// WebKitGTK (Linux) processes pinch-to-zoom and Ctrl+scroll at the
// native GTK/compositor layer before JS fires, so preventDefault()
// alone cannot stop it. We use Tauri's setZoom API (direct native
// bridge) to reset zoom every frame via requestAnimationFrame so the
// webview zoom never visually persists — it snaps back within ~16ms.
const appWindow = getCurrentWebviewWindow();

// Event-driven: catch Ctrl+wheel and Ctrl+key immediately.
document.addEventListener(
  "wheel",
  (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      appWindow.setZoom(1.0);
    }
  },
  { passive: false },
);
document.addEventListener("keydown", (e) => {
  if (
    (e.ctrlKey || e.metaKey) &&
    (e.key === "+" || e.key === "-" || e.key === "=" || e.key === "0")
  ) {
    e.preventDefault();
    appWindow.setZoom(1.0);
  }
});

// rAF loop: reset zoom every frame (~16ms). Pinch-to-zoom on trackpads
// doesn't fire wheel events — it's a native gesture that only the
// polling approach catches. rAF is cheap (one IPC call per frame) and
// guarantees the zoom never visually deviates from 1.0.
(function lockZoom() {
  appWindow.setZoom(1.0);
  requestAnimationFrame(lockZoom);
})();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
