# Use a Node.js base image
FROM node:20-alpine

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies (including devDependencies for ts-node)
RUN npm install

# Copy the rest of the application code
COPY . .

# No build step needed when using ts-node

# Expose the port the app runs on (if applicable)
# EXPOSE 3000

# Command to run the application using ts-node
CMD ["npx", "ts-node", "src/index.ts"]
