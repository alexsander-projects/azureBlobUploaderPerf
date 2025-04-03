const electronAPI = {
    selectFiles: async (mode) => {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.webkitdirectory = mode === 'folders'; // Enable folder selection
            input.onchange = () => {
                const files = Array.from(input.files || []).map(file => ({
                    blob: file,
                    path: file.webkitRelativePath || file.name // Full relative path or just name
                }));
                console.log('Files selected in browser:', files.map(f => f.path));
                resolve(files);
            };
            input.click();
        });
    },
    uploadFiles: async (data) => {
        console.log('Sending upload request with files:', data.files.map(f => f.path));
        const formData = new FormData();
        formData.append('connection_string', data.connection_string);
        formData.append('container_name', data.container_name);
        formData.append('access_tier', data.access_tier);
        data.files.forEach((fileObj, index) => {
            formData.append('file', fileObj.blob); // File content
            formData.append('path', fileObj.path);  // Relative path
        });

        const response = await fetch('/upload-files', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            console.error('Fetch failed with status:', response.status);
            electronAPI._resultCallback({ error: `Server responded with ${response.status}` });
            return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const processStream = async () => {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonData = line.substring(6);
                        try {
                            const result = JSON.parse(jsonData);
                            console.log('SSE message:', result);
                            if (result.progress !== undefined) {
                                electronAPI._progressCallback(result);
                            } else if (result.success || result.error) {
                                electronAPI._resultCallback(result);
                            }
                        } catch (e) {
                            console.error('Error parsing SSE data:', e);
                        }
                    }
                }
            }
        };

        processStream().catch(err => {
            console.error('Stream error:', err);
            electronAPI._resultCallback({ error: err.message });
        });
    },
    cancelUpload: () => {
        console.log('Cancel not implemented in web version');
    },
    onUploadProgress: (callback) => {
        electronAPI._progressCallback = callback;
    },
    onUploadResult: (callback) => {
        electronAPI._resultCallback = callback;
    },
    _progressCallback: () => {},
    _resultCallback: () => {}
};

window.electronAPI = electronAPI;
console.log('web-preload.js loaded, electronAPI available:', window.electronAPI);