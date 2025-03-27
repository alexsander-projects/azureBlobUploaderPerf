# Blob Uploader App for Azure Blob Storage

This is a simple Python application that allows you to upload files to Azure Blob Storage. 
It uses TypeScript for the interface and leverages Python for the upload process.

## How to use

Run the following commands to start the application:

To Build the app:

```bash
pyinstaller --onefile --add-data "C:\Users\Alexs\AppData\Local\Programs\Python\Python312\Lib\site-packages\azure;azure" blob_uploader.py
```

To Run the app:

```bash
npm run build
npm start
```
