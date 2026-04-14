/**
 * IARIS Desktop — Electron Main Process
 *
 * Startup sequence:
 *   1. Spawn FastAPI backend (venv Python + uvicorn)
 *   2. Show loading window while polling /api/state
 *   3. When backend ready → load http://127.0.0.1:8000 in main window
 *   4. On window close → kill backend → quit
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path  = require('path');
const { spawn, execSync } = require('child_process');
const http  = require('http');

// ─── Config ─────────────────────────────────────────────────────────────────

const PORT        = 8000;
const API_BASE    = `http://127.0.0.1:${PORT}`;
const POLL_MS     = 500;
const POLL_TIMEOUT_MS = 15000;  // 15 seconds max wait

// Resolve venv Python relative to this file (frontend/electron/ → project root)
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PYTHON_BIN   = path.join(PROJECT_ROOT, 'venv', 'Scripts', 'python.exe');

// ─── State ───────────────────────────────────────────────────────────────────

let mainWindow   = null;
let loadingWin   = null;
let backendProc  = null;
let pollTimer    = null;
let pollStart    = null;

// ─── Backend Management ───────────────────────────────────────────────────────

function spawnBackend() {
  console.log('[IARIS] Spawning backend:', PYTHON_BIN);
  console.log('[IARIS] Project root:    ', PROJECT_ROOT);

  backendProc = spawn(
    PYTHON_BIN,
    ['-m', 'uvicorn', 'iaris.api:app', '--host', '127.0.0.1', '--port', String(PORT), '--log-level', 'warning'],
    {
      cwd:      PROJECT_ROOT,
      detached: false,
      env:      { ...process.env, PYTHONUNBUFFERED: '1' },
    }
  );

  backendProc.stdout.on('data', d => process.stdout.write('[backend] ' + d));
  backendProc.stderr.on('data', d => process.stderr.write('[backend] ' + d));

  backendProc.on('close', code => {
    console.log(`[IARIS] Backend exited with code ${code}`);
    backendProc = null;
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
  loadingWin = new BrowserWindow({
    width:  500,
    height: 300,
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
      .logo { font-size: 40px; margin-bottom: 16px; }
      h1 { font-size: 22px; font-weight: 700; color: #00d4ff; letter-spacing: 2px; }
      p  { font-size: 13px; color: #8b949e; margin-top: 8px; }
      .dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: #00d4ff;
        margin-top: 24px;
        animation: pulse 1.2s ease-in-out infinite;
      }
      @keyframes pulse {
        0%, 100% { opacity: 0.3; transform: scale(0.8); }
        50%       { opacity: 1;   transform: scale(1.2); }
      }
    </style>
    </head>
    <body>
      <div class="logo">⚙</div>
      <h1>IARIS</h1>
      <p>Starting intelligence engine…</p>
      <div class="dot"></div>
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

  mainWindow.loadURL(`${API_BASE}`);

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
