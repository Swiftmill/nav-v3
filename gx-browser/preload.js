import { contextBridge, ipcRenderer } from 'electron';

const api = {
  storage: {
    get: (key) => ipcRenderer.invoke('gx:store:get', key),
    set: (key, value) => ipcRenderer.invoke('gx:store:set', key, value)
  },
  themes: {
    list: () => ipcRenderer.invoke('gx:themes:list')
  },
  extensions: {
    list: () => ipcRenderer.invoke('gx:extensions:list')
  },
  modules: {
    list: () => ipcRenderer.invoke('gx:modules:list'),
    invoke: (moduleId, command, payload) => ipcRenderer.invoke('gx:module:invoke', moduleId, command, payload),
    subscribe: (moduleId, handler) => {
      const channel = `gx:module:${moduleId}`;
      const listener = (_event, data) => handler?.(data);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }
  },
  dialogs: {
    openDownloads: () => ipcRenderer.invoke('gx:dialog:openDownloads')
  },
  session: {
    update: (state) => ipcRenderer.send('gx:session:update', state)
  },
  notifyError: (message) => ipcRenderer.invoke('gx:show-error', message)
};

contextBridge.exposeInMainWorld('gx', api);
