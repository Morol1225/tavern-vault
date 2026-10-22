import { VaultStorage, DirectoryMemory } from './storage.js';
import { VaultUI } from './ui.js';
import { createTavernHost, installEntrances, reportStartupError } from './host.js';

let configuredCss = '';
let activeInstance;
export function configureVault(css) { configuredCss = css; }

export function startVault(css = configuredCss, mainWindow = window) {
  let ui;
  let stopEntrances;
  try {
    const host = createTavernHost(mainWindow);
    const instanceKey = '__tavernVaultInstance';
    host.window[instanceKey]?.destroy?.();
    host.document.getElementById('tavern-vault-error')?.remove();
    ui = new VaultUI(host, new VaultStorage(host.window), new DirectoryMemory(host.window), css);
    let destroyed = false;
    const instance = {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        stopEntrances?.();
        ui.destroy();
        mainWindow.removeEventListener('pagehide', instance.destroy);
        if (host.window[instanceKey] === instance) delete host.window[instanceKey];
        if (activeInstance === instance) activeInstance = null;
      },
    };
    host.window[instanceKey] = instance;
    activeInstance = instance;
    mainWindow.addEventListener('pagehide', instance.destroy);
    stopEntrances = installEntrances(host, ui);
    // Restoration is asynchronous and never holds the extension activation hook open.
    queueMicrotask(() => { if (!destroyed) ui.restore(); });
    return instance;
  } catch (error) {
    stopEntrances?.();
    ui?.destroy();
    reportStartupError(mainWindow, error);
    return null;
  }
}

export function onActivate() { startVault(); }
export function onEnable() { startVault(); }
export function onDisable() { activeInstance?.destroy(); }
export function onDelete() { onDisable(); }
