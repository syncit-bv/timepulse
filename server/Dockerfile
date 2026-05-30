FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json ./
RUN npm install --omit=dev

COPY . .

# Data directory for SQLite
RUN mkdir -p /data
VOLUME ["/data"]

ENV PORT=3456
ENV DB_PATH=/data/timepulse.db

EXPOSE 3456

CMD ["node", "src/index.js"]
