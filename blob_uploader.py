import sys
import threading
from queue import Queue
from azure.storage.blob import BlobServiceClient
from typing import Dict, Optional
import json
import os
import logging
import unicodedata

# Force UTF-8 for stdin and stdout
sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
logging.basicConfig(stream=sys.stderr, level=logging.INFO)

def sanitize_blob_name(file_path: str, base_dir: str) -> str:
    relative_path = os.path.relpath(file_path, base_dir).replace("\\", "/")
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
    def __init__(self, connection_string: str, container_name: str, num_threads: int = 4):
        self.blob_service_client = BlobServiceClient.from_connection_string(connection_string)
        self.container_name = container_name
        self.num_threads = num_threads
        self.upload_queue = Queue()
        self.results: Dict[str, str] = {}
        self.lock = threading.Lock()

    def upload_file(self, file_path: str) -> Optional[str]:
        try:
            logging.info(f"Received file path: {file_path}")
            base_dir = os.path.dirname(file_path)
            blob_name = sanitize_blob_name(file_path, base_dir)
            blob_client = self.blob_service_client.get_blob_client(
                container=self.container_name,
                blob=blob_name
            )
            logging.info(f"Opening file: {file_path}")
            with open(file_path, "rb") as data:
                blob_client.upload_blob(data, overwrite=True)
            return f"Successfully uploaded {file_path}"
        except Exception as e:
            return f"Error uploading {file_path}: {str(e)}"

    def worker(self):
        while True:
            try:
                file_path = self.upload_queue.get_nowait()
            except:
                break
            result = self.upload_file(file_path)
            with self.lock:
                self.results[file_path] = result
            self.upload_queue.task_done()

    def upload_files(self, file_paths: list) -> Dict[str, str]:
        self.results = {}
        for file_path in file_paths:
            self.upload_queue.put(file_path)
        threads = []
        for _ in range(min(self.num_threads, len(file_paths))):
            t = threading.Thread(target=self.worker)
            t.start()
            threads.append(t)
        for t in threads:
            t.join()
        return self.results

def main():
    try:
        raw_input = sys.stdin.readline()
        logging.info(f"Raw input: {raw_input}")
        input_data = json.loads(raw_input)
        connection_string = input_data["connection_string"]
        container_name = input_data["container_name"]
        file_paths = input_data["file_paths"]
        logging.info(f"Parsed file paths: {file_paths}")

        all_files = []
        for path in file_paths:
            if os.path.isdir(path):
                for root, _, files in os.walk(path):
                    for file in files:
                        all_files.append(os.path.join(root, file))
            else:
                all_files.append(path)

        uploader = BlobUploader(connection_string, container_name)
        results = uploader.upload_files(all_files)
        print(json.dumps(results, ensure_ascii=False))
        sys.stdout.flush()
    except Exception as e:
        logging.error(f"Main error: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()