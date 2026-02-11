const { app, BrowserWindow, dialog, ipcMain, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const { fork } = require('child_process');
const net = require('net');

let mainWindow = null;
let tray = null;
let serverProcess = null;
let serverPort = null;
let errorHandler = null;

// Find an available port
function getAvailablePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

// Start the Express server as a child process
async function startServer() {
  serverPort = await getAvailablePort();

  return new Promise((resolve, reject) => {
    serverProcess = fork(
      path.join(__dirname, '..', 'bin', 'llcapp-server.js'),
      [],
      {
        env: { ...process.env, PORT: String(serverPort) },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
      }
    );

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[ELECTRON] Server:', output.trim());
      if (output.includes('Listening on')) {
        resolve(serverPort);
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[ELECTRON] Server error:', data.toString().trim());
    });

    serverProcess.on('error', reject);

    // Timeout - resolve anyway after 5 seconds
    setTimeout(() => resolve(serverPort), 5000);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'LLCApp - Coding Agent',
    icon: path.join(__dirname, 'icons', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#1a1a2e',
    show: false
  });

  mainWindow.loadURL(`http://localhost:${serverPort}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      if (tray) {
        showNotification('LLCApp', 'Minimized to system tray');
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create application menu
  createAppMenu();
}

function createTray() {
  // Use a simple icon (create placeholder if needed)
  const iconPath = path.join(__dirname, 'icons', 'tray.png');
  try {
    tray = new Tray(iconPath);
  } catch {
    // If icon doesn't exist, create from nativeImage
    const icon = nativeImage.createEmpty();
    tray = new Tray(icon);
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show LLCApp',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'New Session',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send('new-session');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit LLCApp',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('LLCApp - Coding Agent');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createAppMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('new-session');
            }
          }
        },
        {
          label: 'Select Project...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory'],
              title: 'Select Project Directory'
            });
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow.webContents.send('project-selected', result.filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.isQuitting = true;
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
}

// IPC handlers
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Project Directory'
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

// Alias for file-browser.js compatibility
ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Project Folder'
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('show-notification', (event, { title, body }) => {
  showNotification(title, body);
});

// Initialize error handler (dynamic import for ESM module in CommonJS Electron main)
async function initErrorHandler() {
  try {
    const sessionsDir = path.join(__dirname, '..', 'sessions');
    const mod = await import('../src/core/error-handler.js');
    errorHandler = mod.default;
    errorHandler.initialize(sessionsDir);

    // Listen for fatal errors and show dialog to user
    errorHandler.onError('fatal', (entry) => {
      console.error(`[ELECTRON] Fatal error: ${entry.message}`);
      if (mainWindow) {
        mainWindow.webContents.send('error-reported', entry);
      }
      dialog.showErrorBox('LLCApp Fatal Error', `${entry.message}\n\nCheck crash report in sessions/ directory.`);
    });

    console.log('[ELECTRON] Error handler initialized');
  } catch (err) {
    console.warn('[ELECTRON] Could not initialize error handler:', err.message);
  }
}

// App lifecycle
app.on('ready', async () => {
  console.log('[ELECTRON] Starting LLCApp Desktop...');

  try {
    await initErrorHandler();
    await startServer();
    console.log(`[ELECTRON] Server running on port ${serverPort}`);

    createWindow();
    createTray();

    console.log('[ELECTRON] Desktop app ready');
  } catch (error) {
    console.error('[ELECTRON] Failed to start:', error);
    if (errorHandler) errorHandler.report('fatal', error, { source: 'electron-ready' });
    dialog.showErrorBox('LLCApp Error', `Failed to start server: ${error.message}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // Don't quit on macOS when all windows closed
  if (process.platform !== 'darwin') {
    app.isQuitting = true;
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;

  // Kill server process
  if (serverProcess) {
    console.log('[ELECTRON] Stopping server...');
    serverProcess.kill();
    serverProcess = null;
  }
});
