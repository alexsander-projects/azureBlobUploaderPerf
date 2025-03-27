import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null;
let uploadProcess: ChildProcess | null = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

ipcMain.on('select-files', async (event, mode: string) => {
    if (!mainWindow) return;

    const options: Electron.OpenDialogOptions = {
        properties: mode === 'folders' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']
    };

    const result = await dialog.showOpenDialog(mainWindow, options);
    if (!result.canceled) {
        console.log('Selected paths:', result.filePaths);
        event.reply('files-selected', result.filePaths);
    }
});

ipcMain.on('upload-files', (event, data: { connection_string: string, container_name: string, files: string[], access_tier: string }) => {
    // path to Python script
    const pythonScriptPath = app.isPackaged
    ?path.join(process.resourcesPath, 'blob_uploader.py'):path.join(__dirname, 'blob_uploader.py');
    uploadProcess = spawn('C:\\Users\\Alexs\\AppData\\Local\\Programs\\Python\\Python312\\python.exe', [pythonScriptPath]);

    console.log('Sending file paths to Python:', data.files);

    const jsonString = JSON.stringify({
        connection_string: data.connection_string,
        container_name: data.container_name,
        file_paths: data.files,
        access_tier: data.access_tier // Add access tier to JSON
    }) + '\n';

    const jsonData = Buffer.from(jsonString, 'utf-8');
    uploadProcess.stdin?.write(jsonData);
    uploadProcess.stdin?.end();

    let output = '';
    let errorOutput = '';
    uploadProcess.stdout?.on('data', (chunk) => {
        output += chunk;
    });
    uploadProcess.stderr?.on('data', (chunk) => {
        errorOutput += chunk;
    });

    uploadProcess.on('close', (code) => {
        console.log('Python process exited with code:', code);
        uploadProcess = null;
        if (code === 0) {
            event.reply('upload-result', JSON.parse(output));
        } else {
            event.reply('upload-result', { error: `Upload process failed: ${errorOutput || 'Unknown error'}` });
        }
    });
});

ipcMain.on('cancel-upload', () => {
    if (uploadProcess) {
        uploadProcess.kill('SIGTERM');
        uploadProcess = null;
        if (mainWindow) {
            mainWindow.webContents.send('upload-result', { error: 'Upload cancelled by user' });
        }
    }
});