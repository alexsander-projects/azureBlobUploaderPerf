// preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    selectFiles: (mode: string) => ipcRenderer.invoke('select-files', mode),
    uploadFiles: (data: any) => ipcRenderer.invoke('upload-files', data),
    cancelUpload: () => ipcRenderer.send('cancel-upload'),
    onUploadResult: (callback: (result: any) => void) => ipcRenderer.on('upload-result', (event, result) => callback(result))
});