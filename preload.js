const { contextBridge, ipcRenderer } = require('electron');

// Expose APIs to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Listen for auth completion events from main process
  onAuthComplete: (callback) => {
    ipcRenderer.on('auth-complete', (event, data) => {
      callback(data);
    });
  },
  // Open URL in external browser
  openExternal: (url) => {
    ipcRenderer.send('open-external', url);
  },
  // Open auth popup for a specific partition
  openAuthPopup: (url, partition) => {
    ipcRenderer.send('open-auth-popup', { url, partition });
  },
  // Touch ID and password management
  authenticateTouchID: () => {
    return ipcRenderer.invoke('authenticate-touch-id');
  },
  isSessionAuthenticated: () => {
    return ipcRenderer.invoke('is-session-authenticated');
  },
  savePassword: (accountId, password) => {
    return ipcRenderer.invoke('save-password', { accountId, password });
  },
  getPassword: (accountId) => {
    return ipcRenderer.invoke('get-password', { accountId });
  },
  hasPassword: (accountId) => {
    return ipcRenderer.invoke('has-password', { accountId });
  },
  deletePassword: (accountId) => {
    return ipcRenderer.invoke('delete-password', { accountId });
  },
  // Listen for mailto: links from OS
  onOpenMailto: (callback) => {
    ipcRenderer.on('open-mailto', (event, url) => callback(url));
  },
  // Open a Gmail compose popup window
  openComposePopup: (composeUrl, partition) => {
    ipcRenderer.send('open-compose-popup', { composeUrl, partition });
  }
});
