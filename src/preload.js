'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // window controls
  winMinimize: () => ipcRenderer.invoke('win:minimize'),
  winMaximize: () => ipcRenderer.invoke('win:maximize'),
  winClose: () => ipcRenderer.invoke('win:close'),
  setWindowTransparency: (value) => ipcRenderer.invoke('win:setTransparency', value),

  // meta / info
  meta: () => ipcRenderer.invoke('app:meta'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),

  // versions
  listVersions: () => ipcRenderer.invoke('versions:list'),

  // settings (persisted to hidden userData folder)
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (obj) => ipcRenderer.invoke('settings:set', obj),

  // analysis
  pingServer: (opts) => ipcRenderer.invoke('server:ping', opts),
  parseSpark: (text) => ipcRenderer.invoke('analyze:parseSpark', text),
  advise: (input) => ipcRenderer.invoke('analyze:advise', input),
  fetchSpark: (url) => ipcRenderer.invoke('analyze:fetchSpark', url),

  // test control
  startTest: (config) => ipcRenderer.invoke('test:start', config),
  updateTest: (config) => ipcRenderer.invoke('test:update', config),
  stopTest: () => ipcRenderer.invoke('test:stop'),
  testStatus: () => ipcRenderer.invoke('test:status'),

  // events from main -> renderer
  onBotEvent: (handler) => {
    const listener = (_e, payload) => handler(payload);
    ipcRenderer.on('bot-event', listener);
    return () => ipcRenderer.removeListener('bot-event', listener);
  }
});
