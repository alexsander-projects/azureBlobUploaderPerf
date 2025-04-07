from flask import Flask, request, jsonify, render_template, send_from_directory
import threading
import subprocess
import json
import os
import tempfile
import uuid
import logging

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = tempfile.gettempdir()

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Store upload processes and their status
upload_processes = {}


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/static/<path:path>')
def send_static(path):
    return send_from_directory('static', path)


@app.route('/api/upload', methods=['POST'])
def upload():
    # Get form data
    connection_string = request.form.get('connection_string')
    container_name = request.form.get('container_name')
    access_tier = request.form.get('access_tier', 'Hot')

    uploaded_files = request.files.getlist('files')

    if not connection_string or not container_name or not uploaded_files:
        return jsonify({"error": "Missing required parameters"}), 400

    # Generate unique ID for this upload process
    upload_id = str(uuid.uuid4())
    upload_dir = os.path.join(app.config['UPLOAD_FOLDER'], upload_id)

    # Create base upload directory
    os.makedirs(upload_dir, exist_ok=True)

    # Save files to temporary location
    file_paths = []
    original_paths = []

    for file in uploaded_files:
        # Get relative path (for folders) or filename
        relative_path = file.filename

        # For folder uploads, create the necessary subdirectories
        temp_path = os.path.join(upload_dir, relative_path)
        os.makedirs(os.path.dirname(temp_path), exist_ok=True)

        # Save the file
        file.save(temp_path)
        file_paths.append(temp_path)
        original_paths.append(relative_path)

    # Prepare input for blob_uploader.py
    input_data = {
        "connection_string": connection_string,
        "container_name": container_name,
        "file_paths": file_paths,
        "original_paths": original_paths,
        "access_tier": access_tier
    }

    # Track upload process
    upload_processes[upload_id] = {
        "status": "running",
        "progress": 0,
        "completedFiles": 0,
        "totalFiles": len(file_paths),
        "results": {}
    }

    # Start upload in a separate thread
    thread = threading.Thread(target=run_uploader, args=(upload_id, input_data))
    thread.daemon = True
    thread.start()

    return jsonify({"upload_id": upload_id})


def run_uploader(upload_id, input_data):
    try:
        # Run blob_uploader.py as a subprocess
        process = subprocess.Popen(
            ["python", "blob_uploader.py"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # Send input as JSON
        stdout, stderr = process.communicate(json.dumps(input_data))

        if process.returncode == 0:
            results = json.loads(stdout)
            upload_processes[upload_id]["status"] = "completed"
            upload_processes[upload_id]["progress"] = 100
            upload_processes[upload_id]["completedFiles"] = len(input_data["file_paths"])
            upload_processes[upload_id]["results"] = results
        else:
            logger.error(f"Upload process failed: {stderr}")
            upload_processes[upload_id]["status"] = "failed"
            upload_processes[upload_id]["results"] = {"error": stderr}
    except Exception as e:
        logger.error(f"Error in upload process: {str(e)}")
        upload_processes[upload_id]["status"] = "failed"
        upload_processes[upload_id]["results"] = {"error": str(e)}
    finally:
        # Clean up temporary files
        # Clean up temporary files
        for path in input_data["file_paths"]:
            try:
                os.remove(path)
            except Exception as e:
                logger.warning(f"Failed to clean up temporary file {path}: {str(e)}")


@app.route('/api/status/<upload_id>', methods=['GET'])
def status(upload_id):
    if upload_id not in upload_processes:
        return jsonify({"error": "Upload ID not found"}), 404

    return jsonify(upload_processes[upload_id])


@app.route('/api/cancel/<upload_id>', methods=['POST'])
def cancel(upload_id):
    if upload_id not in upload_processes:
        return jsonify({"error": "Upload ID not found"}), 404

    # Update the status to cancelled
    upload_processes[upload_id]["status"] = "cancelled"

    # Clean up temp files if they still exist
    if "file_paths" in upload_processes[upload_id]:
        for path in upload_processes[upload_id]["file_paths"]:
            try:
                if os.path.exists(path):
                    os.remove(path)
            except Exception as e:
                logger.warning(f"Failed to clean up temporary file {path}: {str(e)}")

    # Add cancel signal to the process record
    # (blob_uploader should check this flag)
    upload_processes[upload_id]["cancelled"] = True

    return jsonify({"status": "cancelled"})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
