import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import "./styles/theme.css";

// ── Webview zoom prevention (event-driven only) ──
// Block Ctrl+scroll and Ctrl+± from triggering native page zoom.
// No polling — just event handlers that call setZoom on the specific
// events that trigger zoom. The Rust-side connect_zoom_level_notify
// and connect_scroll_event handlers provide the native-layer backup.
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
