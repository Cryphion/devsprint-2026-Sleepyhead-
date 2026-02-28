FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY src/ ./src/

EXPOSE 3004

CMD ["node", "src/index.js"]