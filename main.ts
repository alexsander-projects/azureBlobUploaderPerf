import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';

let mainWindow: BrowserWindow | null;
let uploadProcess: ChildProcess | null = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('select-files', async (event, mode: string) => {
    if (!mainWindow) return [];
    const options: Electron.OpenDialogOptions = {
        properties: mode === 'folders' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']
    };
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('upload-files', (event, data: { connection_string: string, container_name: string, files: string[], access_tier: string }) => {
    const uploaderPath = app.isPackaged
        ? path.join(process.resourcesPath, 'blob_uploader.exe')
        : path.join(__dirname, '..', 'blob_uploader.exe');

    console.log('Attempting to spawn:', uploaderPath);

    if (!fs.existsSync(uploaderPath)) {
        console.error('File does not exist at:', uploaderPath);
        throw new Error(`Uploader executable not found at: ${uploaderPath}`);
    }

    uploadProcess = spawn(uploaderPath, [], { windowsHide: true });

    uploadProcess.on('error', (err) => {
        console.error('Spawn error:', err);
        if (mainWindow) mainWindow.webContents.send('upload-result', { error: `Spawn failed: ${err.message}` });
    });

    console.log('Starting upload process with', data.files.length, 'files');

    const jsonData = {
        connection_string: data.connection_string,
        container_name: data.container_name,
        file_paths: data.files,  // Changed from "files"
        access_tier: data.access_tier
    };
    console.log('Input data:', JSON.stringify(jsonData, null, 2));

    const jsonString = JSON.stringify(jsonData) + '\n';

    if (!uploadProcess.stdin) {
        throw new Error('Failed to start upload process');
    }
    uploadProcess.stdin.write(jsonString);
    uploadProcess.stdin.end();

    return new Promise((resolve) => {
        if (uploadProcess) {
            let output = '';
            let errorOutput = '';

            uploadProcess.stdout?.on('data', (chunk) => {
                output += chunk;
                console.log('stdout:', chunk.toString());
            });
            uploadProcess.stderr?.on('data', (chunk) => {
                errorOutput += chunk;
                console.log('stderr:', chunk.toString());
            });

            uploadProcess.on('close', (code) => {
                console.log('Process exited with code:', code);
                console.log('Final output:', output || 'No output');
                console.log('Final error output:', errorOutput || 'No error output');
                uploadProcess = null;
                if (code === 0 && output) {
                    try {
                        resolve(JSON.parse(output));
                    } catch (e: any) {
                        resolve({ error: `Invalid output from uploader: ${e.message}` });
                    }
                } else {
                    resolve({ error: `Upload failed: ${errorOutput || 'Unknown error'} (Exit code: ${code})` });
                }
            });
        } else {
            resolve({ error: 'Upload process not initialized' });
        }
    });
});

ipcMain.on('cancel-upload', () => {
    if (uploadProcess) {
        uploadProcess.kill('SIGTERM');
        uploadProcess = null;
        if (mainWindow) mainWindow.webContents.send('upload-result', { error: 'Upload cancelled' });
    }
});