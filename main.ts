import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { spawn } from 'child_process';

let mainWindow: BrowserWindow | null;

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

ipcMain.on('upload-files', (event, data: { connection_string: string, container_name: string, files: string[] }) => {
    const pythonScriptPath = path.join(__dirname, '..', 'blob_uploader.py');
    const pythonProcess = spawn('C:\\Users\\Alexs\\AppData\\Local\\Programs\\Python\\Python312\\python.exe', [pythonScriptPath]);


    console.log('Sending file paths to Python:', data.files);

    const jsonString = JSON.stringify({
        connection_string: data.connection_string,
        container_name: data.container_name,
        file_paths: data.files
    }) + '\n'; // Add newline to terminate input

    const jsonData = Buffer.from(jsonString, 'utf-8');
    pythonProcess.stdin.write(jsonData);
    pythonProcess.stdin.end();

    let output = '';
    let errorOutput = '';
    pythonProcess.stdout.on('data', (chunk) => {
        output += chunk;
    });
    pythonProcess.stderr.on('data', (chunk) => {
        errorOutput += chunk;
    });

    pythonProcess.on('close', (code) => {
        console.log('Python process exited with code:', code);
        if (code === 0) {
            event.reply('upload-result', JSON.parse(output));
        } else {
            event.reply('upload-result', { error: `Upload process failed: ${errorOutput || 'Unknown error'}` });
        }
    });
});