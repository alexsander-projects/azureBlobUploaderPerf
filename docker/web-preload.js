// Replacement for Electron's preload script
window.electronAPI = {
    // Keep track of the current upload
    currentUploadId: null,

    // Select files from the browser
    selectFiles: function(mode) {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;

            // Handle folder selection (as much as browsers allow)
            if (mode === 'folders') {
                input.webkitdirectory = true;
            }

            input.onchange = (event) => {
                const files = Array.from(event.target.files).map(file => {
                    return {
                        path: file.name,
                        blob: file
                    };
                });
                resolve(files);
            };

            input.click();
        });
    },

    // Upload files to the server
    uploadFiles: async function(data) {
        try {
            const formData = new FormData();

            // Add metadata
            formData.append('connection_string', data.connection_string);
            formData.append('container_name', data.container_name);
            formData.append('access_tier', data.access_tier);

            // Add files
            data.files.forEach(file => {
                formData.append('files', file.blob, file.path);
            });

            // Send the request
            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Upload failed');
            }

            const result = await response.json();
            this.currentUploadId = result.upload_id;

            // Start polling for status
            this.pollStatus();
        } catch (error) {
            this.onUploadResultCallback({ error: error.message });
        }
    },

    // Poll for upload status
    pollStatus: function() {
        if (!this.currentUploadId) return;

        const statusInterval = setInterval(async () => {
            try {
                const response = await fetch(`/api/status/${this.currentUploadId}`);
                const status = await response.json();

                if (status.status === 'running') {
                    // Calculate progress
                    const progress = Math.round((status.completedFiles / status.totalFiles) * 100) || status.progress;
                    this.onUploadProgressCallback({
                        progress: progress,
                        completedFiles: status.completedFiles,
                        totalFiles: status.totalFiles
                    });
                } else {
                    // Upload completed, failed or was cancelled
                    clearInterval(statusInterval);

                    if (status.status === 'completed') {
                        this.onUploadResultCallback(status.results);
                    } else {
                        this.onUploadResultCallback({
                            error: status.results.error || `Upload ${status.status}`
                        });
                    }
                }
            } catch (error) {
                console.error('Error checking status:', error);
            }
        }, 1000);
    },

    // Cancel the current upload
    cancelUpload: async function() {
        if (!this.currentUploadId) return;

        try {
            await fetch(`/api/cancel/${this.currentUploadId}`, {
                method: 'POST'
            });
        } catch (error) {
            console.error('Error cancelling upload:', error);
        }
    },

    // Event callbacks
    onUploadProgressCallback: function(progress) {
        // Will be overridden by the actual implementation
        console.log('Progress:', progress);
    },

    onUploadResultCallback: function(results) {
        // Will be overridden by the actual implementation
        console.log('Results:', results);
    },

    // Set up event handlers
    onUploadProgress: function(callback) {
        this.onUploadProgressCallback = callback;
    },

    onUploadResult: function(callback) {
        this.onUploadResultCallback = callback;
    }
};