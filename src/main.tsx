import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/theme.css";

// ── Block native webview zoom globally ──
// Tauri's WebView2 (Windows) and WebKitGTK (Linux) handle Ctrl+scroll
// and Ctrl+± at the native layer. Intercepting at the document level
// with passive:false prevents the webview from zooming the entire app.
document.addEventListener(
  "wheel",
  (e) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); },
  { passive: false },
);
document.addEventListener("keydown", (e) => {
  if (
    (e.ctrlKey || e.metaKey) &&
    (e.key === "+" || e.key === "-" || e.key === "=" || e.key === "0")
  ) {
    e.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
