FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application source code
COPY . .

# Expose port (imutflix-backend runs on port 3001)
EXPOSE 3001

# Command to run the server
CMD ["node", "server.js"]
