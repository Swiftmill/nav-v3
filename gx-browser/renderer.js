const gx = window.gx;
const stores = ['settings', 'bookmarks', 'history', 'sessions', 'search'];

const state = {
  settings: null,
  bookmarks: [],
  history: [],
  search: null,
  themes: [],
  extensions: [],
  modules: [],
  tabs: [],
  activeTabId: null,
  sidebarVisible: true,
  notes: '',
  speedDial: [
    { title: 'YouTube', url: 'https://www.youtube.com/' },
    { title: 'Reddit', url: 'https://www.reddit.com/' },
    { title: 'Netflix', url: 'https://www.netflix.com/' },
    { title: 'Spotify', url: 'https://open.spotify.com/' }
  ]
};

const elements = {
  tabstrip: document.getElementById('tabstrip'),
  address: document.getElementById('address-input'),
  suggestions: document.getElementById('suggestions'),
  home: document.getElementById('home-view'),
  webviews: document.getElementById('webviews'),
  sidebar: document.getElementById('sidebar'),
  panel: document.getElementById('panel'),
  panelTitle: document.getElementById('panel-title'),
  panelClose: document.getElementById('panel-close'),
  panelContent: document.getElementById('panel-content'),
  modulesSlot: document.getElementById('modules-slot'),
  extensionsSlot: document.getElementById('extensions-slot'),
  toolbar: document.getElementById('toolbar'),
  wallpaper: document.getElementById('home-wallpaper'),
  wallpaperToggle: document.getElementById('wallpaper-toggle'),
  wallpaperMute: document.getElementById('wallpaper-mute'),
  homeFavorites: document.getElementById('home-favorites'),
  homeSpeed: document.getElementById('home-speed'),
  homeNotes: document.getElementById('home-notes'),
  homeClock: document.getElementById('home-clock')
};

let sessionSaveTimer;
let userStyleElement;
let userScriptLoaded = false;
const closedTabs = [];
const moduleSubscriptions = [];
let currentPanel = null;
const downloadsState = { items: [] };

function generateId() {
  return `tab-${Math.random().toString(36).slice(2, 9)}`;
}

async function bootstrap() {
  try {
    const [settings, bookmarks, history, sessions, search] = await Promise.all(
      stores.map((key) => gx.storage.get(key))
    );
    state.settings = settings;
    state.bookmarks = bookmarks;
    state.history = history;
    state.search = search;
    state.notes = sessions.notes || '';
    state.speedDial = sessions.speedDial?.length ? sessions.speedDial : state.speedDial;

    state.themes = await gx.themes.list();
    state.extensions = await gx.extensions.list();
    state.modules = await gx.modules.list();

    applyTheme(settings.theme || 'default');
    applyLayout(settings.layout || {});
    loadUserStyles();
    loadUserScript();

    bindUI();
    bindKeybinds();
    populateSidebar();
    populateHome();

    if (sessions?.tabs?.length) {
      for (const tab of sessions.tabs) {
        await createTab({ url: tab.url, activate: false, isRestored: true });
      }
      if (sessions.activeId && state.tabs.find((t) => t.id === sessions.activeId)) {
        switchTab(sessions.activeId);
      } else if (state.tabs.length) {
        switchTab(state.tabs[0].id);
      }
    } else {
      await createTab({ url: settings.home || 'home://gx', activate: true });
    }

    updateSession();
    startClock();
  } catch (err) {
    console.error(err);
    gx.notifyError('Erreur au démarrage. Voir la console pour plus de détails.');
  }
}

function bindUI() {
  document.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', handleActionClick);
  });

  document.querySelectorAll('[data-panel]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      const panelId = event.currentTarget.dataset.panel;
      openBuiltinPanel(panelId);
    });
  });

  elements.address.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      navigateFromInput(elements.address.value.trim());
      elements.suggestions.classList.add('hidden');
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      navigateSuggestions(event.key === 'ArrowDown');
      event.preventDefault();
    }
  });

  elements.address.addEventListener('input', () => {
    const value = elements.address.value.trim();
    if (!value) {
      hideSuggestions();
      return;
    }
    const results = buildSuggestions(value);
    renderSuggestions(results);
  });

  document.addEventListener('click', (event) => {
    if (!elements.suggestions.contains(event.target) && event.target !== elements.address) {
      hideSuggestions();
    }
  });

  elements.panelClose.addEventListener('click', () => {
    currentPanel = null;
    togglePanel(false);
  });
  elements.wallpaperToggle.addEventListener('change', () => {
    elements.wallpaper.classList.toggle('hidden', !elements.wallpaperToggle.checked);
  });
  elements.wallpaperMute.addEventListener('change', () => {
    elements.wallpaper.muted = elements.wallpaperMute.checked;
  });
  elements.homeNotes.addEventListener('input', () => {
    state.notes = elements.homeNotes.value;
    queueSessionSave();
  });
}

function bindKeybinds() {
  const keyMap = state.settings.keybinds || {};
  window.addEventListener('keydown', (event) => {
    const combo = normalizeKeyEvent(event);
    switch (combo) {
      case normalizeKeybind(keyMap.newTab):
        event.preventDefault();
        createTab({ url: state.settings.home || 'home://gx', activate: true });
        break;
      case normalizeKeybind(keyMap.closeTab):
        event.preventDefault();
        if (state.activeTabId) closeTab(state.activeTabId);
        break;
      case normalizeKeybind(keyMap.reopenTab):
        event.preventDefault();
        reopenLastClosed();
        break;
      case normalizeKeybind(keyMap.focusAddress):
        event.preventDefault();
        elements.address.focus();
        elements.address.select();
        break;
      case normalizeKeybind(keyMap.toggleSidebar):
        event.preventDefault();
        toggleSidebar();
        break;
      case normalizeKeybind(keyMap.fullscreen):
        event.preventDefault();
        toggleFullscreen();
        break;
      case normalizeKeybind(keyMap.miniMode):
        event.preventDefault();
        document.body.classList.toggle('mini');
        break;
      default:
        break;
    }

    if (event.key === 'Tab' && event.ctrlKey) {
      event.preventDefault();
      cycleTabs(!event.shiftKey);
    }
  });
}

function normalizeKeybind(binding) {
  return binding ? binding.toLowerCase() : '';
}

function normalizeKeyEvent(event) {
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push('ctrl');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
  parts.push(key);
  return parts.join('+');
}

function handleActionClick(event) {
  const action = event.currentTarget.dataset.action;
  switch (action) {
    case 'back':
      getActiveWebContents()?.goBack();
      break;
    case 'forward':
      getActiveWebContents()?.goForward();
      break;
    case 'refresh':
      reloadTab(state.activeTabId);
      break;
    case 'home':
      navigateTo(state.settings.home || 'home://gx');
      break;
    case 'new-tab':
      createTab({ url: state.settings.home || 'home://gx', activate: true });
      break;
    case 'toggle-sidebar':
      toggleSidebar();
      break;
    case 'add-speed': {
      const title = prompt('Nom du site rapide ?');
      const url = prompt('URL ?');
      if (title && url) {
        state.speedDial.push({ title, url });
        populateHome();
        queueSessionSave();
      }
      break;
    }
    case 'edit-favorites':
      openBuiltinPanel('favorites');
      break;
    default:
      break;
  }
}

function buildSuggestions(query) {
  const lower = query.toLowerCase();
  const items = [];
  for (const bookmark of state.bookmarks) {
    if (bookmark.title.toLowerCase().includes(lower) || bookmark.url.toLowerCase().includes(lower)) {
      items.push({ type: 'bookmark', title: bookmark.title, url: bookmark.url });
    }
  }
  for (const item of state.history.slice(-200).reverse()) {
    if (item.title?.toLowerCase().includes(lower) || item.url.toLowerCase().includes(lower)) {
      if (!items.find((existing) => existing.url === item.url)) {
        items.push({ type: 'history', title: item.title || item.url, url: item.url });
      }
    }
  }
  return items.slice(0, 8);
}

function renderSuggestions(items) {
  elements.suggestions.innerHTML = '';
  if (!items.length) {
    hideSuggestions();
    return;
  }
  items.forEach((item, index) => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    div.dataset.index = index;
    div.innerHTML = `<span>${item.title}</span><small>${item.url}</small>`;
    div.addEventListener('mousedown', (event) => {
      event.preventDefault();
      navigateTo(item.url);
      hideSuggestions();
    });
    elements.suggestions.appendChild(div);
  });
  elements.suggestions.classList.remove('hidden');
}

function navigateSuggestions(forward) {
  const items = Array.from(elements.suggestions.querySelectorAll('.suggestion-item'));
  if (!items.length) return;
  let currentIndex = items.findIndex((item) => item.classList.contains('active'));
  if (forward) {
    currentIndex = (currentIndex + 1) % items.length;
  } else {
    currentIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
  }
  items.forEach((item, index) => {
    item.classList.toggle('active', index === currentIndex);
  });
  const active = items[currentIndex];
  if (active) {
    elements.address.value = active.querySelector('small').textContent;
  }
}

function hideSuggestions() {
  elements.suggestions.classList.add('hidden');
  elements.suggestions.innerHTML = '';
}

async function navigateFromInput(input) {
  if (!input) return;
  const url = resolveInput(input);
  await navigateTo(url);
}

function resolveInput(input) {
  if (isLikelyUrl(input)) {
    const hasProtocol = /^(https?|file|data):/i.test(input);
    return hasProtocol ? input : `https://${input}`;
  }
  const searchSettings = state.search;
  if (input.startsWith('!')) {
    const bang = searchSettings?.bangs?.[input.split(' ')[0]];
    if (bang) {
      const query = input.slice(input.indexOf(' ') + 1).trim();
      const template = searchSettings.providers[bang];
      return template.replace('%s', encodeURIComponent(query));
    }
  }
  const provider = searchSettings?.providers?.[searchSettings.default] ||
    'https://www.google.com/search?q=%s';
  return provider.replace('%s', encodeURIComponent(input));
}

function isLikelyUrl(input) {
  return /\./.test(input) || input.startsWith('http');
}

async function navigateTo(url, tabId = state.activeTabId) {
  if (!tabId) {
    tabId = (await createTab({ url, activate: true })).id;
    return;
  }
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab) return;

  if (url.startsWith('home://')) {
    tab.type = 'home';
    tab.url = url;
    showHome(true);
    elements.address.value = '';
    updateTab(tabId, { title: 'Accueil GX', url });
    updateSession();
    return;
  }

  showHome(false);
  if (tab.type !== 'webview') {
    await ensureWebview(tab);
  }
  tab.type = 'webview';
  tab.url = url;
  tab.webview.src = url;
  tab.webview.classList.add('visible');
  updateTab(tabId, { title: 'Chargement...', url });
  switchTab(tabId);
  elements.address.value = url;
}

async function ensureWebview(tab) {
  if (tab.webview) return;
  const webview = document.createElement('webview');
  webview.setAttribute('partition', 'persist:gx');
  webview.setAttribute('allowpopups', 'true');
  webview.preload = '';
  webview.classList.add('visible');
  elements.webviews.appendChild(webview);
  tab.webview = webview;

  webview.addEventListener('did-start-loading', () => {
    updateTab(tab.id, { loading: true });
  });

  webview.addEventListener('did-stop-loading', () => {
    updateTab(tab.id, { loading: false });
  });

  webview.addEventListener('did-navigate', (event) => {
    handleNavigation(tab, event.url, webview.getTitle());
  });

  webview.addEventListener('did-navigate-in-page', (event) => {
    handleNavigation(tab, event.url, webview.getTitle());
  });

  webview.addEventListener('page-title-updated', (event) => {
    updateTab(tab.id, { title: event.title });
  });
}

async function createTab({ url, activate = true, isRestored = false }) {
  const id = generateId();
  const tab = { id, title: 'Nouvel onglet', url, type: 'home', webview: null, history: [] };
  state.tabs.push(tab);

  const el = document.createElement('div');
  el.className = 'tab';
  el.dataset.id = id;
  el.innerHTML = `
    <span class="favicon">🌐</span>
    <span class="title">${tab.title}</span>
    <button class="close" aria-label="Fermer">×</button>
  `;
  el.addEventListener('click', (event) => {
    if (event.target.classList.contains('close')) {
      closeTab(id);
      event.stopPropagation();
    } else {
      switchTab(id);
    }
  });
  elements.tabstrip.appendChild(el);
  tab.element = el;

  if (isRestored && url) {
    await navigateTo(url, id);
  } else if (url) {
    await navigateTo(url, id);
  }

  if (activate) {
    switchTab(id);
  }

  return tab;
}

function updateTab(id, updates) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  Object.assign(tab, updates);
  if (tab.element && updates.title) {
    tab.element.querySelector('.title').textContent = updates.title;
  }
  if (tab.element) {
    tab.element.classList.toggle('active', tab.id === state.activeTabId);
  }
  updateSession();
}

function switchTab(id) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  state.activeTabId = id;
  state.tabs.forEach((t) => {
    if (t.webview) {
      t.webview.classList.toggle('visible', t.id === id && t.type === 'webview');
    }
    if (t.element) {
      t.element.classList.toggle('active', t.id === id);
    }
  });
  if (tab.type === 'home') {
    showHome(true);
    elements.address.value = '';
  } else if (tab.webview) {
    showHome(false);
    elements.address.value = tab.url || '';
  }
  updateSession();
}

function closeTab(id) {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index === -1) return;
  const [tab] = state.tabs.splice(index, 1);
  if (tab.url) {
    closedTabs.push({ url: tab.url });
    if (closedTabs.length > 10) closedTabs.shift();
  }
  tab.element?.remove();
  tab.webview?.remove();

  if (state.activeTabId === id) {
    const next = state.tabs[index] || state.tabs[index - 1];
    if (next) {
      switchTab(next.id);
    } else {
      createTab({ url: state.settings.home || 'home://gx', activate: true });
    }
  }
  updateSession();
}

function reopenLastClosed() {
  const last = closedTabs.pop();
  if (!last) return;
  createTab({ url: last.url, activate: true });
}

function reloadTab(id) {
  const tab = state.tabs.find((t) => t.id === id);
  if (!tab) return;
  if (tab.type === 'home') {
    populateHome();
    return;
  }
  tab.webview?.reload();
}

function handleNavigation(tab, url, title) {
  tab.url = url;
  if (title) tab.title = title;
  elements.address.value = url;
  if (tab.element) {
    tab.element.querySelector('.title').textContent = title || url;
  }
  showHome(false);
  pushHistory({ title: title || url, url });
  updateSession();
}

function pushHistory(entry) {
  const existingIndex = state.history.findIndex((item) => item.url === entry.url);
  const record = { ...entry, lastVisited: Date.now() };
  if (existingIndex !== -1) {
    state.history.splice(existingIndex, 1);
  }
  state.history.push(record);
  if (state.history.length > 500) {
    state.history.splice(0, state.history.length - 500);
  }
  gx.storage.set('history', state.history);
}

function toggleSidebar() {
  state.sidebarVisible = !state.sidebarVisible;
  elements.sidebar.classList.toggle('collapsed', !state.sidebarVisible);
}

function togglePanel(force) {
  const shouldShow = typeof force === 'boolean' ? force : elements.panel.classList.contains('hidden');
  elements.panel.classList.toggle('hidden', !shouldShow);
  if (!shouldShow) {
    currentPanel = null;
  }
}

function getActiveWebContents() {
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  return tab?.webview || null;
}

function cycleTabs(forward) {
  if (!state.tabs.length) return;
  const index = state.tabs.findIndex((t) => t.id === state.activeTabId);
  let nextIndex = index;
  if (forward) {
    nextIndex = (index + 1) % state.tabs.length;
  } else {
    nextIndex = index === 0 ? state.tabs.length - 1 : index - 1;
  }
  switchTab(state.tabs[nextIndex].id);
}

function toggleFullscreen() {
  const isFull = document.fullscreenElement;
  if (isFull) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

function applyTheme(themeId) {
  const theme = state.themes.find((t) => t.id === themeId) || state.themes.find((t) => t.id === 'default');
  if (!theme) return;
  const vars = theme.vars || {};
  Object.entries(vars).forEach(([key, value]) => {
    document.documentElement.style.setProperty(key, value);
  });
  const app = document.getElementById('app');
  if (theme.glass) {
    app.dataset.glass = 'true';
  } else {
    delete app.dataset.glass;
  }
  if (theme.wallpaper) {
    elements.wallpaper.src = theme.wallpaper;
    elements.wallpaper.classList.toggle('hidden', !elements.wallpaperToggle.checked);
  }
}

function applyLayout(layout) {
  if (!layout) return;
  if (layout.sidebar === 'right') {
    elements.sidebar.style.order = '3';
  } else {
    elements.sidebar.style.order = '0';
  }
  if (layout.density === 'compact') {
    document.body.classList.add('density-compact');
  } else {
    document.body.classList.remove('density-compact');
  }
}

function populateSidebar() {
  moduleSubscriptions.splice(0).forEach((dispose) => dispose?.());
  elements.modulesSlot.innerHTML = '';
  elements.extensionsSlot.innerHTML = '';

  state.modules
    .filter((mod) => mod.enabled)
    .forEach((mod) => {
      const btn = document.createElement('button');
      btn.className = 'sidebar-btn';
      btn.textContent = mod.manifest?.name || mod.id;
      btn.addEventListener('click', () => openModulePanel(mod));
      elements.modulesSlot.appendChild(btn);

      moduleSubscriptions.push(
        gx.modules.subscribe(mod.id, (payload) => handleModuleEvent(mod.id, payload))
      );

      if (mod.id === 'downloads') {
        gx.modules
          .invoke('downloads', 'list')
          .then((items) => {
            downloadsState.items = items || [];
            if (currentPanel?.type === 'module' && currentPanel.id === 'downloads') {
              renderDownloadsPanel();
            }
          })
          .catch(() => {});
      }
    });

  state.extensions.forEach((ext) => {
    if (ext.manifest?.menu?.sidebar) {
      const btn = document.createElement('button');
      btn.className = 'sidebar-btn';
      btn.textContent = ext.manifest.name;
      btn.addEventListener('click', () => openExtensionPanel(ext));
      elements.extensionsSlot.appendChild(btn);
    }
  });
}

function openExtensionPanel(extension) {
  elements.panelTitle.textContent = extension.manifest.name;
  elements.panelContent.innerHTML = '';
  const frame = document.createElement('iframe');
  frame.src = `extensions/${extension.id}/panel.html`;
  elements.panelContent.appendChild(frame);
  currentPanel = { type: 'extension', id: extension.id };
  togglePanel(true);
}

function populateHome() {
  elements.homeFavorites.innerHTML = '';
  state.bookmarks.forEach((bookmark) => {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = bookmark.title;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      navigateTo(bookmark.url);
    });
    const small = document.createElement('small');
    small.textContent = bookmark.url;
    link.appendChild(small);
    li.appendChild(link);
    elements.homeFavorites.appendChild(li);
  });

  elements.homeSpeed.innerHTML = '';
  state.speedDial.forEach((site) => {
    const div = document.createElement('div');
    div.className = 'speed-tile';
    div.textContent = site.title;
    div.addEventListener('click', () => navigateTo(site.url));
    elements.homeSpeed.appendChild(div);
  });

  elements.homeNotes.value = state.notes || '';
}

function showHome(visible) {
  elements.home.classList.toggle('visible', visible);
}

function openBuiltinPanel(panelId) {
  currentPanel = { type: 'builtin', id: panelId };
  elements.panelContent.innerHTML = '';
  switch (panelId) {
    case 'favorites':
      elements.panelTitle.textContent = 'Favoris';
      renderFavoritesPanel();
      break;
    case 'history':
      elements.panelTitle.textContent = 'Historique';
      renderHistoryPanel();
      break;
    case 'extensions':
      elements.panelTitle.textContent = 'Extensions';
      renderExtensionsPanel();
      break;
    case 'settings':
      elements.panelTitle.textContent = 'Paramètres';
      renderSettingsPanel();
      break;
    default:
      currentPanel = null;
      return;
  }
  togglePanel(true);
}

function renderFavoritesPanel() {
  elements.panelContent.innerHTML = '';
  const addBtn = document.createElement('button');
  addBtn.textContent = 'Ajouter un favori';
  addBtn.addEventListener('click', async () => {
    const title = prompt('Titre du favori ?');
    const url = prompt('URL du favori ?');
    if (title && url) {
      state.bookmarks.push({ title, url });
      await gx.storage.set('bookmarks', state.bookmarks);
      populateHome();
      renderFavoritesPanel();
    }
  });
  elements.panelContent.appendChild(addBtn);

  const list = document.createElement('ul');
  list.className = 'downloads-list';
  if (!state.bookmarks.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Aucun favori.';
    elements.panelContent.appendChild(empty);
    return;
  }
  state.bookmarks.forEach((bookmark, index) => {
    const li = document.createElement('li');
    li.className = 'download-item';
    const info = document.createElement('div');
    info.style.display = 'grid';
    info.innerHTML = `<strong>${bookmark.title}</strong><span>${bookmark.url}</span>`;
    const actions = document.createElement('div');
    const openBtn = document.createElement('button');
    openBtn.textContent = 'Ouvrir';
    openBtn.addEventListener('click', () => navigateTo(bookmark.url));
    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Supprimer';
    removeBtn.addEventListener('click', async () => {
      state.bookmarks.splice(index, 1);
      await gx.storage.set('bookmarks', state.bookmarks);
      populateHome();
      renderFavoritesPanel();
    });
    actions.append(openBtn, removeBtn);
    li.append(info, actions);
    list.appendChild(li);
  });
  elements.panelContent.appendChild(list);
}

function renderHistoryPanel() {
  if (!state.history.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Historique vide.';
    elements.panelContent.appendChild(empty);
    return;
  }
  const list = document.createElement('ul');
  list.className = 'downloads-list';
  state.history
    .slice()
    .reverse()
    .forEach((item) => {
      const li = document.createElement('li');
      li.className = 'download-item';
      li.innerHTML = `
        <div class="history-item">
          <strong>${item.title || item.url}</strong>
          <span>${new Date(item.lastVisited).toLocaleString()}</span>
        </div>
      `;
      li.addEventListener('click', () => navigateTo(item.url));
      list.appendChild(li);
    });
  elements.panelContent.appendChild(list);
}

function renderExtensionsPanel() {
  if (!state.extensions.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Aucune extension installée.';
    elements.panelContent.appendChild(empty);
    return;
  }
  const container = document.createElement('div');
  container.className = 'media-panel';
  state.extensions.forEach((ext) => {
    const card = document.createElement('div');
    card.className = 'download-item';
    card.style.display = 'grid';
    card.style.gap = '6px';
    card.innerHTML = `
      <div><strong>${ext.manifest.name}</strong> v${ext.manifest.version || '1.0.0'}</div>
      <small>Permissions: ${(ext.manifest.permissions || []).join(', ') || 'aucune'}</small>
    `;
    container.appendChild(card);
  });
  elements.panelContent.appendChild(container);
}

function renderSettingsPanel() {
  elements.panelContent.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'media-panel';

  const themeLabel = document.createElement('h3');
  themeLabel.textContent = 'Thème';
  container.appendChild(themeLabel);

  const themeSelect = document.createElement('select');
  state.themes.forEach((theme) => {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = theme.name;
    if (state.settings.theme === theme.id) option.selected = true;
    themeSelect.appendChild(option);
  });
  themeSelect.addEventListener('change', async () => {
    state.settings.theme = themeSelect.value;
    await gx.storage.set('settings', state.settings);
    applyTheme(state.settings.theme);
  });
  container.appendChild(themeSelect);

  const modulesLabel = document.createElement('h3');
  modulesLabel.textContent = 'Modules';
  container.appendChild(modulesLabel);

  const modulesList = document.createElement('div');
  modulesList.className = 'media-panel';
  state.modules.forEach((mod) => {
    const row = document.createElement('label');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.gap = '12px';
    const span = document.createElement('span');
    span.textContent = mod.manifest?.name || mod.id;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(state.settings.modules?.[mod.id]);
    checkbox.addEventListener('change', async () => {
      state.settings.modules = state.settings.modules || {};
      state.settings.modules[mod.id] = checkbox.checked;
      state.modules = await gx.storage.set('settings', state.settings).then(() => gx.modules.list());
      populateSidebar();
      if (currentPanel?.type === 'builtin' && currentPanel.id === 'settings') {
        renderSettingsPanel();
      }
    });
    row.append(span, checkbox);
    modulesList.appendChild(row);
  });
  container.appendChild(modulesList);

  elements.panelContent.appendChild(container);
}

function openModulePanel(module) {
  currentPanel = { type: 'module', id: module.id };
  elements.panelTitle.textContent = module.manifest?.name || module.id;
  elements.panelContent.innerHTML = '';
  switch (module.id) {
    case 'downloads':
      renderDownloadsPanel();
      break;
    case 'media-controls':
      renderMediaControlsPanel();
      break;
    case 'adblock':
      renderAdblockPanel();
      break;
    default:
      renderGenericModulePanel(module);
      break;
  }
  togglePanel(true);
}

function renderDownloadsPanel() {
  elements.panelContent.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'downloads-panel';

  const header = document.createElement('div');
  header.className = 'downloads-actions';

  const refresh = document.createElement('button');
  refresh.textContent = 'Actualiser';
  refresh.addEventListener('click', async () => {
    try {
      downloadsState.items = (await gx.modules.invoke('downloads', 'list')) || [];
      renderDownloadsPanel();
    } catch (err) {
      console.warn('Impossible de récupérer les téléchargements', err);
    }
  });

  const openFolder = document.createElement('button');
  openFolder.textContent = 'Ouvrir le dossier';
  openFolder.addEventListener('click', () => gx.dialogs.openDownloads());

  const clear = document.createElement('button');
  clear.textContent = 'Effacer';
  clear.addEventListener('click', async () => {
    try {
      downloadsState.items = (await gx.modules.invoke('downloads', 'clear')) || [];
      renderDownloadsPanel();
    } catch (err) {
      console.warn('Impossible de vider les téléchargements', err);
    }
  });

  header.append(refresh, openFolder, clear);
  container.appendChild(header);

  const list = document.createElement('ul');
  list.className = 'downloads-list';

  if (!downloadsState.items.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Aucun téléchargement en cours.';
    container.appendChild(empty);
  } else {
    downloadsState.items
      .slice()
      .reverse()
      .forEach((item) => {
        const li = document.createElement('li');
        li.innerHTML = `
          <div class="download-item">
            <strong>${item.filename}</strong>
            <span>${formatDownloadStatus(item)}</span>
          </div>
        `;
        list.appendChild(li);
      });
    container.appendChild(list);
  }

  elements.panelContent.appendChild(container);
}

function formatDownloadStatus(item) {
  if (item.state === 'completed') {
    return 'Terminé';
  }
  if (item.state === 'interrupted') {
    return 'Interrompu';
  }
  const percent = item.totalBytes ? Math.round((item.receivedBytes / item.totalBytes) * 100) : 0;
  return `${percent}% - ${item.state}`;
}

function renderMediaControlsPanel() {
  elements.panelContent.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'media-panel';

  const playPause = document.createElement('button');
  playPause.textContent = 'Lecture/Pause onglet actif';
  playPause.addEventListener('click', () => {
    gx.modules.invoke('media-controls', 'toggle');
  });

  container.appendChild(playPause);
  elements.panelContent.appendChild(container);
}

function renderAdblockPanel() {
  elements.panelContent.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'adblock-panel';
  container.innerHTML = `
    <p>GX Shield bloque une sélection de domaines publicitaires courants.</p>
    <p>Vous pouvez ajouter vos propres règles via <code>modules/adblock/module.js</code>.</p>
  `;
  elements.panelContent.appendChild(container);
}

function renderGenericModulePanel(module) {
  elements.panelContent.innerHTML = '';
  const container = document.createElement('div');
  container.innerHTML = `<p>Module <strong>${module.id}</strong> actif.</p>`;
  elements.panelContent.appendChild(container);
}

function handleModuleEvent(moduleId, payload) {
  if (!payload) return;
  if (moduleId === 'downloads' && payload.event === 'updated') {
    downloadsState.items = payload.payload || [];
    if (currentPanel?.type === 'module' && currentPanel.id === 'downloads') {
      renderDownloadsPanel();
    }
  }
  if (moduleId === 'media-controls' && payload.event === 'toggle') {
    toggleActiveMedia();
  }
}

function toggleActiveMedia() {
  const tab = state.tabs.find((t) => t.id === state.activeTabId);
  if (!tab?.webview) return;
  tab.webview
    .executeJavaScript(`
      (() => {
        const media = document.querySelector('video, audio');
        if (!media) return 'Aucun média';
        if (media.paused) {
          media.play();
          return 'Lecture';
        }
        media.pause();
        return 'Pause';
      })();
    `)
    .catch(() => {});
}

function startClock() {
  const update = () => {
    const now = new Date();
    elements.homeClock.textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  update();
  setInterval(update, 1000);
}

function updateSession() {
  clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => {
    const data = {
      tabs: state.tabs.map((tab) => ({ id: tab.id, url: tab.url, type: tab.type })),
      activeId: state.activeTabId,
      notes: state.notes,
      speedDial: state.speedDial
    };
    gx.session.update(data);
    gx.storage.set('sessions', data);
  }, 250);
}

function queueSessionSave() {
  updateSession();
}

async function loadUserStyles() {
  try {
    const response = await fetch('user/user.css');
    if (!response.ok) return;
    const text = await response.text();
    if (!userStyleElement) {
      userStyleElement = document.createElement('style');
      userStyleElement.id = 'user-style';
      document.head.appendChild(userStyleElement);
    }
    userStyleElement.textContent = text;
  } catch (err) {
    console.warn('Impossible de charger user.css', err);
  }
}

function loadUserScript() {
  if (userScriptLoaded) return;
  const script = document.createElement('script');
  script.type = 'module';
  script.src = 'user/user.js';
  script.onerror = () => console.warn('Impossible de charger user.js');
  document.body.appendChild(script);
  userScriptLoaded = true;
}

bootstrap();

window.addEventListener('beforeunload', () => {
  moduleSubscriptions.splice(0).forEach((dispose) => dispose?.());
});
