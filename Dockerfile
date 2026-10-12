FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.js"]
