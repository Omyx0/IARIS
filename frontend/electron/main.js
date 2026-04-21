/**
 * IARIS Desktop — Electron Main Process
 *
 * Startup sequence:
 *   1. Spawn FastAPI backend (venv Python + uvicorn)
 *   2. Show loading window while polling /api/state
 *   3. When backend ready → load bundled React UI (dist/index.html)
 *   4. On window close → kill backend → quit
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path  = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const http  = require('http');

// ─── Config ─────────────────────────────────────────────────────────────────

const PORT        = 8000;
const API_BASE    = `http://127.0.0.1:${PORT}`;
const POLL_MS     = 500;
const POLL_TIMEOUT_MS = 15000;  // 15 seconds max wait

const EXE_NAME = 'iaris_engine.exe';
const DEV_PROJECT_ROOT = path.join(__dirname, '..', '..');
const PROJECT_ROOT = app.isPackaged ? process.resourcesPath : DEV_PROJECT_ROOT;
const FRONTEND_INDEX = path.join(__dirname, '..', 'dist', 'index.html');

function resolveBackendPath() {
  const candidates = [
    // Packaged mode: in resources/
    path.join(process.resourcesPath, EXE_NAME),
    // Development mode: in dist/ (where PyInstaller builds it)
    path.join(DEV_PROJECT_ROOT, 'dist', EXE_NAME),
  ];

  console.log('[IARIS] Searching for backend executable in candidates:');
  candidates.forEach(c => console.log(`  - ${c}`));

  const found = candidates.find((candidate) => fs.existsSync(candidate)) || null;
  console.log(`[IARIS] Using backend executable: ${found}`);
  return found;
}

const BACKEND_EXE = resolveBackendPath();

// Debug logging for paths
console.log(`[IARIS] App packaged: ${app.isPackaged}`);
console.log(`[IARIS] App path: ${app.getAppPath()}`);
console.log(`[IARIS] Resources path: ${process.resourcesPath}`);
console.log(`[IARIS] Project root: ${PROJECT_ROOT}`);
console.log(`[IARIS] Frontend index: ${FRONTEND_INDEX}`);

// (Python bin resolution removed in favor of standalone executable)

// ─── State ───────────────────────────────────────────────────────────────────

let mainWindow   = null;
let loadingWin   = null;
let backendProc  = null;
let pollTimer    = null;
let pollStart    = null;
let startupError = '';

// ─── Backend Management ───────────────────────────────────────────────────────

function spawnBackend() {
  if (!BACKEND_EXE) {
    startupError = 'Backend executable not found. Expected iaris_engine.exe.';
    console.error('[IARIS] ' + startupError);
    return;
  }

  console.log('[IARIS] Spawning backend:', BACKEND_EXE);
  console.log('[IARIS] CWD:             ', PROJECT_ROOT);

  backendProc = spawn(BACKEND_EXE, [String(PORT)], {
    cwd:      PROJECT_ROOT,
    detached: false,
    env:      { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  backendProc.stdout.on('data', d => process.stdout.write('[backend] ' + d));
  backendProc.stderr.on('data', d => process.stderr.write('[backend] ' + d));

  backendProc.on('close', code => {
    console.log(`[IARIS] Backend exited with code ${code}`);
    backendProc = null;
  });

  backendProc.on('error', err => {
    startupError = `Backend spawn failed: ${err.message}`;
    console.error('[IARIS] ' + startupError);
  });
}

function killBackend() {
  if (!backendProc) return;
  console.log('[IARIS] Killing backend process...');
  try {
    if (process.platform === 'win32') {
      // On Windows, spawn creates a process group — kill it entirely
      execSync(`taskkill /PID ${backendProc.pid} /T /F`, { stdio: 'ignore' });
    } else {
      backendProc.kill('SIGTERM');
    }
  } catch (_) {}
  backendProc = null;
}

// ─── Health Poll ──────────────────────────────────────────────────────────────

function pollBackend(onReady, onTimeout) {
  pollStart = Date.now();

  function attempt() {
    http.get(`${API_BASE}/api/state`, (res) => {
      if (res.statusCode === 200) {
        onReady();
      } else {
        scheduleRetry();
      }
      res.resume(); // drain response
    }).on('error', () => {
      scheduleRetry();
    });
  }

  function scheduleRetry() {
    if (Date.now() - pollStart > POLL_TIMEOUT_MS) {
      onTimeout();
      return;
    }
    pollTimer = setTimeout(attempt, POLL_MS);
  }

  attempt();
}

// ─── Windows ──────────────────────────────────────────────────────────────────

function createLoadingWindow() {
  const logoPath = path.join(PROJECT_ROOT, 'frontend', 'src', 'assets', 'IARIS_logo1.png');
  let logoDataUri = '';

  try {
    const logoBase64 = fs.readFileSync(logoPath).toString('base64');
    logoDataUri = `data:image/png;base64,${logoBase64}`;
  } catch (err) {
    console.warn('[IARIS] Splash logo missing or unreadable:', err.message);
  }

  loadingWin = new BrowserWindow({
    width:  520,
    height: 360,
    frame:  false,
    transparent: true,
    resizable:   false,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  loadingWin.loadURL(`data:text/html,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        display: flex; flex-direction: column;
        align-items: center; justify-content: center;
        height: 100vh;
        background: rgba(13, 17, 23, 0.97);
        font-family: -apple-system, 'Segoe UI', sans-serif;
        color: #c9d1d9;
        border-radius: 12px;
        border: 1px solid rgba(0, 212, 255, 0.3);
      }
      .logo {
        width: 164px;
        height: 164px;
        object-fit: contain;
        margin-bottom: 14px;
        filter: drop-shadow(0 8px 24px rgba(0, 212, 255, 0.18));
      }
      p  { font-size: 22px; color: #8b949e; margin-top: 2px; }
    </style>
    </head>
    <body>
      ${logoDataUri ? `<img class="logo" src="${logoDataUri}" alt="IARIS logo" />` : ''}
      <p>Starting the intelgence engine...</p>
    </body>
    </html>
  `)}`);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width:    1400,
    height:   900,
    minWidth: 1100,
    minHeight: 700,
    show:    false,
    backgroundColor: '#0d1117',
    titleBarStyle: 'default',
    webPreferences: {
      preload:         path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'IARIS — Intent-Aware Adaptive Resource Intelligence',
  });

  // Load the bundled renderer directly. Renderer talks to backend via absolute API/WS URLs.
  if (fs.existsSync(FRONTEND_INDEX)) {
    mainWindow.loadFile(FRONTEND_INDEX);
  } else {
    // Fallback for unexpected packaging layouts.
    console.warn('[IARIS] Frontend bundle not found, falling back to backend root URL');
    mainWindow.loadURL(`${API_BASE}`);
  }

  mainWindow.once('ready-to-show', () => {
    if (loadingWin && !loadingWin.isDestroyed()) {
      loadingWin.close();
      loadingWin = null;
    }
    mainWindow.show();
    mainWindow.focus();
  });

  // Open external links in default browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createLoadingWindow();
  spawnBackend();

  pollBackend(
    // ─── Backend ready ───────────────────────────────────────────────────
    () => {
      console.log('[IARIS] Backend ready — opening dashboard');
      createMainWindow();
    },
    // ─── Timeout ─────────────────────────────────────────────────────────
    () => {
      console.error('[IARIS] Backend failed to start within timeout');
      if (loadingWin && !loadingWin.isDestroyed()) {
        loadingWin.loadURL(`data:text/html,${encodeURIComponent(`
          <!DOCTYPE html>
          <html>
          <head>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              display: flex; flex-direction: column; align-items: center; justify-content: center;
              height: 100vh; background: #0d1117; font-family: -apple-system, sans-serif;
              color: #c9d1d9; border-radius: 12px; border: 1px solid rgba(231,76,60,0.4);
              padding: 32px; text-align: center;
            }
            h1 { color: #e74c3c; margin-bottom: 12px; }
            p  { color: #8b949e; font-size: 13px; line-height: 1.6; margin-bottom: 8px; }
            button {
              margin-top: 20px; padding: 10px 24px;
              background: transparent; border: 1px solid #e74c3c;
              color: #e74c3c; border-radius: 6px; cursor: pointer; font-size: 14px;
            }
          </style>
          </head>
          <body>
            <h1>⚠ Engine Failed to Start</h1>
            <p>IARIS backend did not respond within 15 seconds.</p>
            ${startupError ? `<p><strong>Details:</strong> ${startupError}</p>` : ''}
            <p>Ensure Python venv is set up: <br/><code>venv\\Scripts\\python -m pip install -e .</code></p>
            <button onclick="window.close()">Close</button>
          </body>
          </html>
        `)}`);
      }
    }
  );
});

// Quit completely when all windows are closed (no tray persistence)
app.on('window-all-closed', () => {
  if (pollTimer) clearTimeout(pollTimer);
  killBackend();
  app.quit();
});

app.on('before-quit', () => {
  if (pollTimer) clearTimeout(pollTimer);
  killBackend();
});

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-backend-url', () => API_BASE);
ipcMain.handle('get-version',     () => app.getVersion());
