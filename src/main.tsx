import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import "./styles/theme.css";

// ── Force-lock webview zoom to 1.0 ──
// WebKitGTK (Linux) processes pinch-to-zoom and Ctrl+scroll at the
// native GTK/compositor layer before JS fires, so preventDefault()
// alone cannot stop it. We use Tauri's own setZoom API (which talks
// directly to the native webview) to snap zoom back to 1.0:
//
//   (a) On every Ctrl+wheel / Ctrl+key event — catches the most
//       common triggers and reverts within one frame.
//   (b) A 500ms polling interval — catches anything that slips
//       through (trackpad gestures, accessibility zoom, etc).
const appWindow = getCurrentWebviewWindow();

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
// Polling safety net — revert zoom no matter how it was triggered.
setInterval(() => appWindow.setZoom(1.0), 500);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
