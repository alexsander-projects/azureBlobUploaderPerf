import json
import logging
import queue
import sys
import threading
from datetime import datetime
from queue import Queue
from typing import Dict, Optional
from azure.storage.blob import BlobServiceClient, StandardBlobTier

import unicodedata


# Force UTF-8 for stdin and stdout
sys.stdin = open(sys.stdin.fileno(), mode='r', encoding='utf-8', buffering=True)
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=True)
logging.basicConfig(stream=sys.stderr, level=logging.INFO)

# Thread-safe file logging
log_file = 'upload_log.txt'
log_lock = threading.Lock()


def log_upload(file_path: str):
    with log_lock:
        with open(log_file, 'a', encoding='utf-8') as f:
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            f.write(f"{timestamp} - Uploaded: {file_path}\n")
            f.flush()


def sanitize_blob_name(file_path: str) -> str:
    logging.info(f"Original blob path: {file_path}")
    normalized = unicodedata.normalize('NFC', file_path)
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

    def upload_file(self, file_path: str, original_path: str) -> Optional[str]:
        if self.cancelled:
            return f"Upload cancelled: {file_path}"
        try:
            logging.info(f"Received temp file path: {file_path}, original path: {original_path}")
            blob_name = sanitize_blob_name(original_path)
            full_blob_path = f"{self.container_name}/{blob_name}"
            blob_client = self.blob_service_client.get_blob_client(container=self.container_name, blob=blob_name)

            # Convert string tier to proper StandardBlobTier enum
            tier_map = {
                'Hot': StandardBlobTier.HOT,
                'Cool': StandardBlobTier.COOL,
                'Archive': StandardBlobTier.ARCHIVE,
                'Cold': StandardBlobTier.COLD
            }

            access_tier = tier_map.get(self.access_tier, StandardBlobTier.HOT)
            logging.info(f"Uploading to blob: {full_blob_path} with access tier: {access_tier}")

            with open(file_path, "rb") as data:
                # Upload the blob
                upload_response = blob_client.upload_blob(data, overwrite=True)

                # Set the access tier after uploading
                blob_client.set_standard_blob_tier(access_tier)

            log_upload(original_path)
            logging.info(f"Response status: {upload_response.status_code}")
            return f"Successfully uploaded {original_path}"
        except Exception as e:
            return f"Error uploading {original_path}: {str(e)}"

    def worker(self):
        while not self.cancelled:
            try:
                file_path, original_path = self.upload_queue.get_nowait()
            except queue.Empty:
                break
            except Exception as e:
                logging.error(f"Worker error: {str(e)}")
                self.upload_queue.task_done()
                continue
            result = self.upload_file(file_path, original_path)
            with self.lock:
                self.results[file_path] = result
            self.upload_queue.task_done()

    def upload_files(self, file_paths: list, original_paths: list = None) -> Dict[str, str]:
        self.results = {}
        if not file_paths:
            return self.results

        original_paths = original_paths or file_paths
        if len(file_paths) != len(original_paths):
            raise ValueError("Mismatch between file_paths and original_paths lengths")

        logging.info(f"Selected temp paths: {file_paths}")
        logging.info(f"Selected original paths: {original_paths}")
        all_files = [(temp, orig) for temp, orig in zip(file_paths, original_paths)]
        logging.info(f"TOTAL_FILES: {len(all_files)}")

        for file_path, original_path in all_files:
            self.upload_queue.put((file_path, original_path))

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
        logging.info("Starting main function")
        raw_input = sys.stdin.read()
        logging.info(f"Raw input received: {raw_input}")
        if not raw_input:
            logging.error("No input received from stdin")
            sys.exit(1)
        input_data = json.loads(raw_input)
        logging.info(f"Parsed input: {json.dumps(input_data, ensure_ascii=False)}")
        connection_string = input_data["connection_string"]
        container_name = input_data["container_name"]
        file_paths = input_data["file_paths"]
        original_paths = input_data.get("original_paths", file_paths)
        access_tier = input_data.get("access_tier", "Hot")
        logging.info(f"Parsed temp file paths: {file_paths}")
        logging.info(f"Parsed original paths: {original_paths}")
        logging.info(f"Access tier: {access_tier}")

        uploader = BlobUploader(connection_string, container_name, access_tier)

        import signal
        signal.signal(signal.SIGTERM, lambda signum, frame: uploader.cancel())

        results = uploader.upload_files(file_paths, original_paths)
        if any("Error uploading" in result for result in results.values()):
            logging.error("Upload errors detected")
            print(json.dumps(results, ensure_ascii=False))
            sys.stdout.flush()
            sys.exit(1)
        logging.info("Upload completed successfully")
        print(json.dumps(results, ensure_ascii=False))
        sys.stdout.flush()
    except Exception as e:
        logging.error(f"Main error: {str(e)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
