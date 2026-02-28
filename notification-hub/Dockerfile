FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

EXPOSE 3004

CMD ["node", "index.js"]