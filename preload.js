const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    openFolder: (path) => ipcRenderer.send('open-folder', path),
    launchGame: (data) => ipcRenderer.send('launch-game', data),
    createInstance: (data) => ipcRenderer.send('create-instance', data),
    loginMicrosoft: () => ipcRenderer.send('login-microsoft'),
    
    downloadMod: (data) => ipcRenderer.send('download-mod', data),
    downloadModpack: (data) => ipcRenderer.send('download-modpack', data), // <-- ¡Esta es la que faltaba!
    
    onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (_event, data) => callback(data)),
    onDownloadComplete: (callback) => ipcRenderer.on('download-complete', (_event, data) => callback(data)),
    onDownloadError: (callback) => ipcRenderer.on('download-error', (_event, err) => callback(err))
});