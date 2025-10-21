import { app, BrowserWindow, ipcMain, dialog, Menu, shell, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const THEMES_DIR = path.join(__dirname, 'themes');
const MODULES_DIR = path.join(__dirname, 'modules');
const EXTENSIONS_DIR = path.join(__dirname, 'extensions');

const moduleChannels = new Map();

const stores = {
  settings: {
    file: path.join(DATA_DIR, 'settings.json'),
    defaults: {
      theme: 'default',
      home: 'home://gx',
      search: '!g',
      keybinds: {
        newTab: 'Ctrl+T',
        closeTab: 'Ctrl+W',
        reopenTab: 'Ctrl+Shift+T',
        focusAddress: 'Ctrl+L',
        toggleSidebar: 'Ctrl+B',
        fullscreen: 'F11',
        miniMode: 'F10'
      },
      layout: { tabPosition: 'top', sidebar: 'left', density: 'comfortable' },
      modules: { adblock: true, downloads: true, 'media-controls': true }
    }
  },
  bookmarks: {
    file: path.join(DATA_DIR, 'bookmarks.json'),
    defaults: [
      { title: 'ChatGPT', url: 'https://chat.openai.com/' },
      { title: 'Discord', url: 'https://discord.com/app' },
      { title: 'GitHub', url: 'https://github.com/' },
      { title: 'YouTube', url: 'https://www.youtube.com/' },
      { title: 'Netflix', url: 'https://www.netflix.com/' }
    ]
  },
  history: {
    file: path.join(DATA_DIR, 'history.json'),
    defaults: []
  },
  sessions: {
    file: path.join(DATA_DIR, 'sessions.json'),
    defaults: { tabs: [] }
  },
  search: {
    file: path.join(DATA_DIR, 'search.json'),
    defaults: {
      default: 'google',
      providers: {
        google: 'https://www.google.com/search?q=%s',
        ddg: 'https://duckduckgo.com/?q=%s',
        brave: 'https://search.brave.com/search?q=%s',
        yt: 'https://www.youtube.com/results?search_query=%s'
      },
      bangs: { '!g': 'google', '!ddg': 'ddg', '!b': 'brave', '!yt': 'yt' }
    }
  }
};

let moduleStates = new Map();
let ipcRegistered = false;
let sessionRegistered = false;
let activeWindow = null;

let currentSessionState = stores.sessions.defaults;

function ensureDirectories() {
  for (const dir of [DATA_DIR, THEMES_DIR, MODULES_DIR, EXTENSIONS_DIR, path.join(__dirname, 'user'), path.join(__dirname, 'assets')]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function atomicWrite(file, data) {
  const payload = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  const tmpFile = `${file}.tmp`;
  const bakFile = `${file}.bak`;
  fs.writeFileSync(tmpFile, payload);
  if (fs.existsSync(bakFile)) {
    fs.rmSync(bakFile, { force: true });
  }
  if (fs.existsSync(file)) {
    fs.renameSync(file, bakFile);
  }
  fs.renameSync(tmpFile, file);
}

function readStore(key) {
  const store = stores[key];
  if (!store) throw new Error(`Unknown store ${key}`);
  try {
    const raw = fs.readFileSync(store.file, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    console.warn(`[store] Failed to read ${key}:`, err.message);
    try {
      if (fs.existsSync(store.file)) {
        const bakFile = `${store.file}.bak`;
        fs.copyFileSync(store.file, bakFile);
      }
    } catch (copyErr) {
      console.warn('Failed to backup corrupt file', copyErr.message);
    }
    atomicWrite(store.file, store.defaults);
    return JSON.parse(JSON.stringify(store.defaults));
  }
}

function writeStore(key, value) {
  const store = stores[key];
  if (!store) throw new Error(`Unknown store ${key}`);
  atomicWrite(store.file, value);
  return value;
}

function hydrateStores() {
  for (const key of Object.keys(stores)) {
    if (!fs.existsSync(stores[key].file)) {
      atomicWrite(stores[key].file, stores[key].defaults);
    } else {
      readStore(key);
    }
  }
}

async function loadThemes() {
  const files = fs.readdirSync(THEMES_DIR).filter((f) => f.endsWith('.json'));
  const themes = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(THEMES_DIR, file), 'utf-8'));
      themes.push({ id: path.basename(file, '.json'), ...data });
    } catch (err) {
      console.warn('Invalid theme file', file, err.message);
    }
  }
  return themes;
}

function resolveModules(settings) {
  const enabled = settings?.modules || {};
  const manifests = [];
  const dirs = fs.existsSync(MODULES_DIR) ? fs.readdirSync(MODULES_DIR, { withFileTypes: true }) : [];
  for (const dirent of dirs) {
    if (!dirent.isDirectory()) continue;
    const manifestPath = path.join(MODULES_DIR, dirent.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      manifests.push({ id: dirent.name, manifest, enabled: Boolean(enabled[dirent.name]) });
    } catch (err) {
      console.warn('Failed to parse module manifest', dirent.name, err.message);
    }
  }
  return manifests;
}

function registerModuleChannel(moduleId, command, handler) {
  const key = `${moduleId}:${command}`;
  moduleChannels.set(key, handler);
  return () => {
    if (moduleChannels.get(key) === handler) {
      moduleChannels.delete(key);
    }
  };
}

async function activateModules(win, manifests, settings) {
  const results = new Map();
  for (const mod of manifests) {
    if (!mod.enabled) continue;
    const moduleFile = path.join(MODULES_DIR, mod.id, 'module.js');
    if (!fs.existsSync(moduleFile)) continue;
    try {
      const moduleUrl = pathToFileURL(moduleFile).href;
      const moduleEntry = await import(moduleUrl);
      if (typeof moduleEntry.activate === 'function') {
        const disposables = [];
        const context = {
          app,
          session: win.webContents.session,
          window: win,
          settings,
          storage: {
            read: (key) => readStore(key),
            write: (key, value) => writeStore(key, value)
          },
          ipcMain,
          shell,
          registerChannel: (command, handler) => {
            disposables.push(registerModuleChannel(mod.id, command, handler));
          },
          emit: (event, payload) => {
            win.webContents.send(`gx:module:${mod.id}`, { event, payload });
          }
        };
        const dispose = await moduleEntry.activate(context);
        results.set(mod.id, {
          dispose: typeof dispose === 'function' ? dispose : null,
          cleanup: () => disposables.forEach((fn) => fn())
        });
      }
    } catch (err) {
      console.warn(`Failed to activate module ${mod.id}:`, err.message);
    }
  }
  moduleStates = results;
}

function deactivateModules() {
  for (const [id, state] of moduleStates.entries()) {
    try {
      state?.dispose?.();
      state?.cleanup?.();
    } catch (err) {
      console.warn(`Failed to deactivate module ${id}:`, err.message);
    }
  }
  moduleStates.clear();
  moduleChannels.clear();
}

function loadExtensions() {
  const results = [];
  if (!fs.existsSync(EXTENSIONS_DIR)) return results;
  const dirs = fs.readdirSync(EXTENSIONS_DIR, { withFileTypes: true });
  for (const dirent of dirs) {
    if (!dirent.isDirectory()) continue;
    const manifestPath = path.join(EXTENSIONS_DIR, dirent.name, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      results.push({ id: dirent.name, manifest });
    } catch (err) {
      console.warn('Invalid extension manifest', dirent.name, err.message);
    }
  }
  return results;
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#09090f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webviewTag: true,
      enableRemoteModule: false,
      spellcheck: true
    }
  });

  win.once('ready-to-show', () => win.show());

  win.loadFile(path.join(__dirname, 'index.html'));

  win.on('closed', () => {
    deactivateModules();
  });

  return win;
}

function setupSessionPersistence(win) {
  if (!sessionRegistered) {
    ipcMain.on('gx:session:update', (_event, payload) => {
      currentSessionState = payload;
    });
    sessionRegistered = true;
  }

  const saveSession = () => {
    try {
      writeStore('sessions', currentSessionState);
    } catch (err) {
      console.error('Failed to persist session', err);
    }
  };

  win.on('close', saveSession);
  app.on('before-quit', saveSession);
}

function setupIPC(win) {
  activeWindow = win;
  if (ipcRegistered) {
    return;
  }

  ipcMain.handle('gx:store:get', (_event, key) => {
    return readStore(key);
  });

  ipcMain.handle('gx:store:set', async (_event, key, value) => {
    const saved = writeStore(key, value);
    if (key === 'settings' && activeWindow) {
      deactivateModules();
      const manifests = resolveModules(saved);
      await activateModules(activeWindow, manifests, saved);
    }
    return saved;
  });

  ipcMain.handle('gx:themes:list', () => loadThemes());
  ipcMain.handle('gx:extensions:list', () => loadExtensions());
  ipcMain.handle('gx:modules:list', () => resolveModules(readStore('settings')));
  ipcMain.handle('gx:module:invoke', async (_event, moduleId, command, payload) => {
    const handler = moduleChannels.get(`${moduleId}:${command}`);
    if (!handler) {
      throw new Error(`Module ${moduleId} ne gère pas ${command}`);
    }
    return handler(payload);
  });
  ipcMain.handle('gx:dialog:openDownloads', () => {
    const downloadDir = app.getPath('downloads');
    shell.openPath(downloadDir);
    return downloadDir;
  });

  ipcMain.handle('gx:show-error', (_event, message) => {
    dialog.showErrorBox('GX Browser', message);
  });

  ipcRegistered = true;
}

function configureSecurity() {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith('http') && !url.startsWith('https') && !url.startsWith('file:') && !url.startsWith('data:')) {
        event.preventDefault();
      }
    });

    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url);
      }
      return { action: 'deny' };
    });
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

app.on('ready', async () => {
  ensureDirectories();
  hydrateStores();
  configureSecurity();
  const win = createMainWindow();
  setupSessionPersistence(win);
  setupIPC(win);
  const settings = readStore('settings');
  const manifests = resolveModules(settings);
  await activateModules(win, manifests, settings);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const win = createMainWindow();
    setupSessionPersistence(win);
    setupIPC(win);
    const settings = readStore('settings');
    const manifests = resolveModules(settings);
    activateModules(win, manifests, settings);
  }
});

Menu.setApplicationMenu(null);
