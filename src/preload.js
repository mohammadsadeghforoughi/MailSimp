const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mailApp', {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  testSmtp: (email) => ipcRenderer.invoke('smtp:test', email),
  chooseExcel: () => ipcRenderer.invoke('excel:choose'),
  importExcel: (payload) => ipcRenderer.invoke('excel:import', payload),
  listRecipients: () => ipcRenderer.invoke('recipients:list'),
  getRecipientFields: () => ipcRenderer.invoke('recipients:fields'),
  addRecipient: (email) => ipcRenderer.invoke('recipients:add', email),
  deleteRecipient: (id) => ipcRenderer.invoke('recipients:delete', id),
  clearRecipients: () => ipcRenderer.invoke('recipients:clear'),
  saveTemplate: (template) => ipcRenderer.invoke('template:save', template),
  sendCampaign: (template) => ipcRenderer.invoke('campaign:send', template),
  getHistory: () => ipcRenderer.invoke('campaign:history'),
  getDeliveries: (id) => ipcRenderer.invoke('campaign:deliveries', id),
  onProgress: (callback) => ipcRenderer.on('campaign:progress', (_event, data) => callback(data))
});
