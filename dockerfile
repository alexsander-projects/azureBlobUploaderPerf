# Use Node.js base image
FROM node:latest

# Install Python and venv
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv

# Create and activate virtual environment
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"

# Install Azure SDK
RUN pip3 install azure-storage-blob

# Create temp upload directory
RUN mkdir -p /tmp/uploads

WORKDIR /app

COPY package.docker.json ./package.json
RUN npm install

COPY index.html server.js web-preload.js blob_uploader.py ./

RUN ls -l /app && echo "Files in /app listed" || echo "Error listing files"

EXPOSE 3000

CMD ["npm", "start"]