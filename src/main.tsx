import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import "./styles/theme.css";

// ── Force-lock webview zoom to 1.0 ──
// WebKitGTK (Linux) has two zoom mechanisms:
//   1. Page zoom (set_zoom_level) — Ctrl+scroll, keyboard shortcuts
//   2. Visual viewport zoom — trackpad pinch-to-zoom gesture
// Tauri's setZoom only controls (1). For (2), we use the visualViewport
// API to detect scale changes and reset via CSS transform compensation.
const appWindow = getCurrentWebviewWindow();

// (1) Page zoom: catch Ctrl+wheel and Ctrl+key, reset via Tauri API.
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
// Periodic page-zoom reset (catches anything the events miss).
setInterval(() => appWindow.setZoom(1.0), 200);

// (2) Visual viewport zoom: detect and compensate via CSS counter-scale.
// When the visual viewport zooms to e.g. 1.5×, we scale the root element
// by 1/1.5 and adjust dimensions so the user sees no net zoom change.
if (window.visualViewport) {
  const root = document.documentElement;
  const onViewportChange = () => {
    const vv = window.visualViewport!;
    if (Math.abs(vv.scale - 1) > 0.01) {
      const inv = 1 / vv.scale;
      root.style.transform = `scale(${inv})`;
      root.style.transformOrigin = "0 0";
      root.style.width = `${vv.scale * 100}%`;
      root.style.height = `${vv.scale * 100}%`;
    } else {
      root.style.transform = "";
      root.style.transformOrigin = "";
      root.style.width = "";
      root.style.height = "";
    }
  };
  window.visualViewport.addEventListener("resize", onViewportChange);
  window.visualViewport.addEventListener("scroll", onViewportChange);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
