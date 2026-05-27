FROM node:20-alpine

WORKDIR /app

# Install dependencies first (for layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --prefer-offline || npm install

# Copy source
COPY . .

# Build the app
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
