FROM node:20-bookworm-slim

# ffmpeg + python/pip (yt-dlp用)
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 python3-pip && \
    pip3 install --no-cache-dir yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Next.js
RUN npm run build
EXPOSE 10000
CMD ["npm", "start"]