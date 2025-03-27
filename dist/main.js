"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
let mainWindow;
let uploadProcess = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
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
electron_1.app.whenReady().then(createWindow);
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0)
        createWindow();
});
electron_1.ipcMain.handle('select-files', (event, mode) => __awaiter(void 0, void 0, void 0, function* () {
    if (!mainWindow)
        return [];
    const options = {
        properties: mode === 'folders' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']
    };
    const result = yield electron_1.dialog.showOpenDialog(mainWindow, options);
    return result.canceled ? [] : result.filePaths;
}));
electron_1.ipcMain.handle('upload-files', (event, data) => {
    const uploaderPath = electron_1.app.isPackaged
        ? path.join(process.resourcesPath, 'blob_uploader.exe')
        : path.join(__dirname, '..', 'blob_uploader.exe');
    console.log('Attempting to spawn:', uploaderPath);
    if (!fs.existsSync(uploaderPath)) {
        console.error('File does not exist at:', uploaderPath);
        throw new Error(`Uploader executable not found at: ${uploaderPath}`);
    }
    uploadProcess = (0, child_process_1.spawn)(uploaderPath, [], { windowsHide: true });
    uploadProcess.on('error', (err) => {
        console.error('Spawn error:', err);
        if (mainWindow)
            mainWindow.webContents.send('upload-result', { error: `Spawn failed: ${err.message}` });
    });
    console.log('Starting upload process with', data.files.length, 'files');
    const jsonData = {
        connection_string: data.connection_string,
        container_name: data.container_name,
        file_paths: data.files, // Changed from "files"
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
        var _a, _b;
        if (uploadProcess) {
            let output = '';
            let errorOutput = '';
            (_a = uploadProcess.stdout) === null || _a === void 0 ? void 0 : _a.on('data', (chunk) => {
                output += chunk;
                console.log('stdout:', chunk.toString());
            });
            (_b = uploadProcess.stderr) === null || _b === void 0 ? void 0 : _b.on('data', (chunk) => {
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
                    }
                    catch (e) {
                        resolve({ error: `Invalid output from uploader: ${e.message}` });
                    }
                }
                else {
                    resolve({ error: `Upload failed: ${errorOutput || 'Unknown error'} (Exit code: ${code})` });
                }
            });
        }
        else {
            resolve({ error: 'Upload process not initialized' });
        }
    });
});
electron_1.ipcMain.on('cancel-upload', () => {
    if (uploadProcess) {
        uploadProcess.kill('SIGTERM');
        uploadProcess = null;
        if (mainWindow)
            mainWindow.webContents.send('upload-result', { error: 'Upload cancelled' });
    }
});
