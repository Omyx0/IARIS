/**
 * IARIS Desktop — Electron Preload Script
 *
 * Exposes a minimal, safe IPC bridge to the renderer process.
 * contextIsolation: true — renderer cannot access Node.js APIs directly.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('iaris', {
  /** Get the FastAPI backend URL (http://127.0.0.1:8000) */
  getBackendUrl: () => ipcRenderer.invoke('get-backend-url'),

  /** Get Electron app version */
  getVersion: () => ipcRenderer.invoke('get-version'),
});
