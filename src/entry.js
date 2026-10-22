import { VaultStorage, DirectoryMemory } from './storage.js';
import { VaultUI } from './ui.js';
import { createTavernHost, installEntrances, reportStartupError } from './host.js';

export function startVault(css) {
  let host;
  let ui;
  let stopEntrances;
  try {
    host = createTavernHost(window);
    const instanceKey = '__tavernVaultInstance';
    host.window[instanceKey]?.destroy?.();
    ui = new VaultUI(host, new VaultStorage(host.window), new DirectoryMemory(host.window), css);
    const instance = {
      destroy() {
        stopEntrances?.();
        ui.destroy();
        window.removeEventListener('pagehide', instance.destroy);
        if (host.window[instanceKey] === instance) delete host.window[instanceKey];
      },
    };
    host.window[instanceKey] = instance;
    window.addEventListener('pagehide', instance.destroy);
    stopEntrances = installEntrances(host, ui);
    ui.restore();
  } catch (error) {
    stopEntrances?.();
    ui?.destroy();
    reportStartupError(window, error);
  }
}
