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
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
let mainWindow;
let uploadProcess = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    mainWindow.loadFile('index.html');
}
electron_1.app.whenReady().then(createWindow);
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
electron_1.ipcMain.on('select-files', (event, mode) => __awaiter(void 0, void 0, void 0, function* () {
    if (!mainWindow)
        return;
    const options = {
        properties: mode === 'folders' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']
    };
    const result = yield electron_1.dialog.showOpenDialog(mainWindow, options);
    if (!result.canceled) {
        console.log('Selected paths:', result.filePaths);
        event.reply('files-selected', result.filePaths);
    }
}));
electron_1.ipcMain.on('upload-files', (event, data) => {
    var _a, _b, _c, _d;
    // path to Python script
    const pythonScriptPath = electron_1.app.isPackaged
        ? path.join(process.resourcesPath, 'blob_uploader.py') : path.join(__dirname, 'blob_uploader.py');
    uploadProcess = (0, child_process_1.spawn)('C:\\Users\\Alexs\\AppData\\Local\\Programs\\Python\\Python312\\python.exe', [pythonScriptPath]);
    console.log('Sending file paths to Python:', data.files);
    const jsonString = JSON.stringify({
        connection_string: data.connection_string,
        container_name: data.container_name,
        file_paths: data.files,
        access_tier: data.access_tier // Add access tier to JSON
    }) + '\n';
    const jsonData = Buffer.from(jsonString, 'utf-8');
    (_a = uploadProcess.stdin) === null || _a === void 0 ? void 0 : _a.write(jsonData);
    (_b = uploadProcess.stdin) === null || _b === void 0 ? void 0 : _b.end();
    let output = '';
    let errorOutput = '';
    (_c = uploadProcess.stdout) === null || _c === void 0 ? void 0 : _c.on('data', (chunk) => {
        output += chunk;
    });
    (_d = uploadProcess.stderr) === null || _d === void 0 ? void 0 : _d.on('data', (chunk) => {
        errorOutput += chunk;
    });
    uploadProcess.on('close', (code) => {
        console.log('Python process exited with code:', code);
        uploadProcess = null;
        if (code === 0) {
            event.reply('upload-result', JSON.parse(output));
        }
        else {
            event.reply('upload-result', { error: `Upload process failed: ${errorOutput || 'Unknown error'}` });
        }
    });
});
electron_1.ipcMain.on('cancel-upload', () => {
    if (uploadProcess) {
        uploadProcess.kill('SIGTERM');
        uploadProcess = null;
        if (mainWindow) {
            mainWindow.webContents.send('upload-result', { error: 'Upload cancelled by user' });
        }
    }
});
