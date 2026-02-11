const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Native file picker
  selectDirectory: () => ipcRenderer.invoke('select-directory'),

  // OS notifications
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', { title, body }),

  // Listen for events from main process
  onNewSession: (callback) => ipcRenderer.on('new-session', callback),
  onProjectSelected: (callback) => ipcRenderer.on('project-selected', (event, path) => callback(path)),

  // Platform info
  platform: process.platform,
  isElectron: true
});
