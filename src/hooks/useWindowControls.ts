import { getCurrentWindow } from '@tauri-apps/api/window';

export function useWindowControls() {
  const appWindow = getCurrentWindow();

  return {
    minimize: () => appWindow.minimize(),
    toggleMaximize: () => appWindow.toggleMaximize(),
    close: () => appWindow.hide(), // D-12: hide to tray, not quit
  };
}
