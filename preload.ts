import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
    selectFiles: (mode: string) => ipcRenderer.invoke('select-files', mode),
    uploadFiles: (data: any) => ipcRenderer.send('upload-files', data),
    cancelUpload: () => ipcRenderer.send('cancel-upload'),
    onUploadProgress: (callback: (progress: any) => void) => ipcRenderer.on('upload-progress', (event, progress) => callback(progress)),
    onUploadResult: (callback: (result: any) => void) => ipcRenderer.on('upload-result', (event, result) => callback(result))
});