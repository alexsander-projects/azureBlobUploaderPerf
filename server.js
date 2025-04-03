const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const app = express();
const port = 3000;

const upload = multer({ dest: '/tmp/uploads/' });

app.use(express.static(__dirname));

app.post('/upload-files', upload.array('file'), async (req, res) => {
    console.log('Received POST /upload-files request');
    console.log('Request headers:', req.headers);
    console.log('Request body:', req.body);
    console.log('Uploaded files:', req.files.map(f => f.originalname));

    const { connection_string, container_name} = req.body;
    const filePaths = Array.isArray(req.body.path) ? req.body.path : [req.body.path];
    const files = req.files.map((file, index) => ({
        tempPath: file.path,
        originalPath: filePaths[index] || file.originalname
    }));

    console.log('Files with paths:', files.map(f => ({ temp: f.tempPath, orig: f.originalPath }))); // Debug

    if (!connection_string || !container_name || !files.length) {
        console.error('Invalid request body or no files uploaded');
        return res.status(400).json({ error: 'Missing or invalid required fields' });
    }

    const uploaderPath = path.join(__dirname, 'blob_uploader.py');
    console.log('Attempting to spawn:', uploaderPath);

    if (!await fs.access(uploaderPath).then(() => true).catch(() => false)) {
        console.error('Uploader script not found at:', uploaderPath);
        return res.status(500).json({ error: `Uploader script not found at: ${uploaderPath}` });
    }

    const uploadProcess = spawn('python3', ['blob_uploader.py'], { env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    let stdoutOutput = '';
    let stderrOutput = '';
    let completedFiles = 0;
    let totalFiles = 0;

    const jsonData = {
        connection_string,
        container_name,
        file_paths: files.map(f => f.tempPath),
        original_paths: files.map(f => f.originalPath)
    };
    console.log('Sending input to uploader:', JSON.stringify(jsonData, null, 2));
    uploadProcess.stdin.write(JSON.stringify(jsonData) + '\n');
    uploadProcess.stdin.end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    console.log('SSE headers set, waiting for uploader output');

    uploadProcess.stderr.on('data', (chunk) => {
        stderrOutput += chunk.toString();
        console.log('stderr chunk:', stderrOutput);
        const lines = stderrOutput.split('\n');
        for (const line of lines) {
            const totalMatch = line.match(/TOTAL_FILES: (\d+)/);
            if (totalMatch) {
                totalFiles = parseInt(totalMatch[1], 10);
                console.log('Total files set to:', totalFiles);
            }
            if (line.includes("Response status: 200") || line.includes("Response status: 201")) {
                completedFiles++;
                if (totalFiles > 0) {
                    const progress = Math.min(Math.round((completedFiles / totalFiles) * 100), 100);
                    console.log(`Progress: ${progress}% (${completedFiles}/${totalFiles})`);
                    res.write(`data: ${JSON.stringify({ progress, totalFiles, completedFiles })}\n\n`);
                }
            }
        }
        stderrOutput = lines[lines.length - 1] || '';
    });

    uploadProcess.stdout.on('data', (chunk) => {
        stdoutOutput += chunk.toString();
        console.log('stdout chunk:', stdoutOutput);
    });

    uploadProcess.on('error', (err) => {
        console.error('Spawn error:', err);
        res.write('data: ' + JSON.stringify({ error: 'Spawn failed: ' + err.message }) + '\n\n');
        res.end();
    });

    uploadProcess.on('close', async (code) => {
        console.log('Uploader process exited with code:', code);
        await Promise.all(req.files.map(file => fs.unlink(file.path).catch(err => console.error('Cleanup error:', err))));
        if (code === 0) {
            console.log('Upload successful');
            res.write(`data: ${JSON.stringify({ success: true })}\n\n`);
        } else {
            console.error('Upload failed with stderr:', stderrOutput);
            res.write('data: ' + JSON.stringify({ error: 'Upload failed: ' + (stderrOutput || 'Unknown error') + ' (Exit code: ' + code + ')' }) + '\n\n');
        }
        res.end();
    });
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});