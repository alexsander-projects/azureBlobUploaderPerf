import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';

let mainWindow: BrowserWindow | null = null;
let uploadProcess: ChildProcess | null = null;

// Create the main window
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
    mainWindow.loadFile('index.html').then(() => console.log('Loaded index.html')).catch(console.error);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Initialize the app
app.whenReady().then(createWindow).catch(console.error);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Handle IPC messages
ipcMain.handle('select-files', async (_event, mode: string): Promise<string[]> => {
    if (!mainWindow) return [];
    const options: Electron.OpenDialogOptions = {
        properties: mode === 'folders' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']
    };
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result.canceled ? [] : result.filePaths;
});

// Data structure for uploading files
interface UploadData {
    connection_string: string;
    container_name: string;
    files: string[];
    access_tier: string;
}

// Handle file upload request from renderer process
ipcMain.on('upload-files', (_event, data: UploadData) => {
    const uploaderPath = app.isPackaged
        ? path.join(process.resourcesPath, 'blob_uploader.exe')
        : path.join(__dirname, '..', 'blob_uploader.exe');

    console.log('Attempting to spawn:', uploaderPath);

    if (!fs.existsSync(uploaderPath)) {
        console.error('File does not exist at:', uploaderPath);
        if (mainWindow) mainWindow.webContents.send('upload-result', { error: `Uploader executable not found at: ${uploaderPath}` });
        return;
    }

    // Spawn with unbuffered output
    uploadProcess = spawn(uploaderPath, [], {
        windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: '1' } // Ensure stdout/stderr isn’t buffered
    });

    // Handle spawn errors
    uploadProcess.on('error', (err) => {
        console.error('Spawn error:', err);
        if (mainWindow) mainWindow.webContents.send('upload-result', { error: `Spawn failed: ${err.message}` });
    });

    console.log('Starting upload process with', data.files.length, 'files');

    const jsonData = {
        connection_string: data.connection_string,
        container_name: data.container_name,
        file_paths: data.files,
        access_tier: data.access_tier
    };
    console.log('Input data:', JSON.stringify(jsonData, null, 2));

    const jsonString = JSON.stringify(jsonData) + '\n';

    if (!uploadProcess.stdin) {
        if (mainWindow) mainWindow.webContents.send('upload-result', { error: 'Failed to start upload process' });
        return;
    }
    uploadProcess.stdin.write(jsonString);
    uploadProcess.stdin.end();

    let stdoutOutput = '';
    let stderrOutput = '';
    let completedFiles = 0;
    const totalFiles = data.files.length;

    // Listen to stderr for Azure SDK logs (requests and responses)
    uploadProcess.stderr?.on('data', (chunk) => {
        stderrOutput += chunk.toString();
        console.log('stderr chunk:', stderrOutput);

        // Process line-by-line for successful responses
        const lines = stderrOutput.split('\n');
        for (const line of lines) {
            if (line.includes("Response status: 200") || line.includes("Response status: 201")) {
                completedFiles++;
                const progress = Math.min(Math.round((completedFiles / totalFiles) * 100), 100);
                console.log(`Progress update: ${progress}% (${completedFiles}/${totalFiles})`);
                if (mainWindow) {
                    mainWindow.webContents.send('upload-progress', { progress, totalFiles, completedFiles });
                }
            }
        }
        // Retain incomplete line
        stderrOutput = lines[lines.length - 1] || '';
    });

    // Still listen to stdout for final result
    uploadProcess.stdout?.on('data', (chunk) => {
        stdoutOutput += chunk.toString();
        console.log('stdout chunk:', stdoutOutput);
    });

    uploadProcess.on('close', (code) => {
        console.log('Process exited with code:', code);
        console.log('Final stdout:', stdoutOutput || 'No output');
        console.log('Final stderr:', stderrOutput || 'No error output');
        uploadProcess = null;
        if (mainWindow) {
            if (code === 0) {
                mainWindow.webContents.send('upload-result', { success: true });
            } else {
                mainWindow.webContents.send('upload-result', { error: `Upload failed with code ${code}` });
            }
        }
    });
});

// Handle upload cancellation request from renderer process
ipcMain.on('cancel-upload', () => {
    if (uploadProcess) {
        uploadProcess.kill('SIGTERM');
        uploadProcess = null;
        if (mainWindow) mainWindow.webContents.send('upload-result', { error: 'Upload cancelled' });
    }
});