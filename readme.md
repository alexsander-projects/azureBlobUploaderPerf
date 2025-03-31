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

To install the app:

- Run the installer located in the dist folder
- The app will be installed in your windows machine
- Run the app

## How it works

The app uses the Azure SDK for Python to upload files to Azure Blob Storage.
It uses typescript to create the interface and Python to handle the upload process.
It handles threads according to the number of files to increase performance.

## Performance

The cpu and ram usage is low, the app is able to handle multiple files at the same time without any issues.
> Notice that disk and network usage will be high
