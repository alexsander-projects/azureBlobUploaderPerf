import sys
import threading
from queue import Queue
from azure.storage.blob import BlobServiceClient
from typing import Dict, Optional
import json
import os
import logging
import unicodedata
from datetime import datetime

# Force UTF-8 for stdin and stdout
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
logging.basicConfig(stream=sys.stderr, level=logging.INFO)

# Thread-safe file logging
log_file = 'upload_log.txt'
log_lock = threading.Lock()


def log_upload(file_path: str):
    with log_lock:  # Ensure thread-safe writes
        with open(log_file, 'a', encoding='utf-8') as f:
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            f.write(f"{timestamp} - Uploaded: {file_path}\n")
            f.flush()  # Force write to disk immediately


def sanitize_blob_name(file_path: str, base_dir: str) -> str:
    relative_path = os.path.relpath(file_path, base_dir).replace("\\", "/")
    logging.info(f"Calculated relative path: {relative_path}")
    normalized = unicodedata.normalize('NFC', relative_path)
    try:
        normalized.encode('utf-8')
        safe_name = ''.join(c if c not in '<>:"|?*' else '_' for c in normalized)
        logging.info(f"Sanitized blob name: {safe_name}")
        return safe_name
    except UnicodeEncodeError:
        safe_name = normalized.encode('utf-8', errors='replace').decode('utf-8')
        safe_name = ''.join(c if c not in '<>:"|?*' else '_' for c in safe_name)
        logging.info(f"Sanitized blob name (fallback): {safe_name}")
        return safe_name


class BlobUploader:
    def __init__(self, connection_string: str, container_name: str, access_tier: str, num_threads: int = 4):
        self.blob_service_client = BlobServiceClient.from_connection_string(connection_string)
        self.container_name = container_name
        self.access_tier = access_tier
        self.num_threads = num_threads
        self.upload_queue = Queue()
        self.results: Dict[str, str] = {}
        self.lock = threading.Lock()
        self.cancelled = False

    def upload_file(self, file_path: str, base_dir: str) -> Optional[str]:
        if self.cancelled:
            return f"Upload cancelled: {file_path}"
        try:
            logging.info(f"Received file path: {file_path}")
            blob_name = sanitize_blob_name(file_path, base_dir)
            full_blob_path = f"{self.container_name}/{blob_name}"
            blob_client = self.blob_service_client.get_blob_client(
                container=self.container_name,
                blob=blob_name
            )
            logging.info(f"Uploading to blob: {full_blob_path} with access tier: {self.access_tier}")
            with open(file_path, "rb") as data:
                blob_client.upload_blob(data, overwrite=True)
                if self.access_tier in ['Hot', 'Cool', 'Cold', 'Archive']:
                    blob_client.set_standard_blob_tier(self.access_tier)
            log_upload(file_path)  # Log immediately after upload
            return f"Successfully uploaded {file_path}"
        except Exception as e:
            return f"Error uploading {file_path}: {str(e)}"

    def worker(self):
        while not self.cancelled:
            try:
                file_path, base_dir = self.upload_queue.get_nowait()
            except:
                break
            result = self.upload_file(file_path, base_dir)
            with self.lock:
                self.results[file_path] = result
            self.upload_queue.task_done()

    def upload_files(self, file_paths: list) -> Dict[str, str]:
        self.results = {}
        if not file_paths:
            return self.results

        if len(file_paths) == 1 and os.path.isdir(file_paths[0]):
            base_dir = os.path.dirname(file_paths[0])
        elif len(file_paths) == 1:
            base_dir = os.path.dirname(os.path.dirname(file_paths[0]))
        else:
            common_parent = os.path.commonpath([os.path.dirname(p) if os.path.isfile(p) else p for p in file_paths])
            base_dir = os.path.dirname(common_parent)

        logging.info(f"Base directory: {base_dir}")
        logging.info(f"Selected paths: {file_paths}")

        all_files = []
        for path in file_paths:
            if os.path.isdir(path):
                for root, _, files in os.walk(path):
                    for file in files:
                        full_path = os.path.join(root, file)
                        all_files.append((full_path, base_dir))
            else:
                all_files.append((path, base_dir))

        for file_path, base_dir in all_files:
            self.upload_queue.put((file_path, base_dir))

        threads = []
        for _ in range(min(self.num_threads, len(all_files))):
            t = threading.Thread(target=self.worker)
            t.start()
            threads.append(t)
        for t in threads:
            t.join()
        return self.results

    def cancel(self):
        self.cancelled = True
        logging.info("Upload cancellation requested")


def main():
    try:
        uploader = None
        raw_input = sys.stdin.readline()
        logging.info(f"Raw input: {raw_input}")
        input_data = json.loads(raw_input)
        connection_string = input_data["connection_string"]
        container_name = input_data["container_name"]
        file_paths = input_data["file_paths"]
        access_tier = input_data.get("access_tier", "Hot")
        logging.info(f"Parsed file paths: {file_paths}")
        logging.info(f"Access tier: {access_tier}")

        uploader = BlobUploader(connection_string, container_name, access_tier)

        import signal
        signal.signal(signal.SIGTERM, lambda signum, frame: uploader.cancel())

        results = uploader.upload_files(file_paths)
        print(json.dumps(results, ensure_ascii=False))
        sys.stdout.flush()
    except Exception as e:
        logging.error(f"Main error: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    main()