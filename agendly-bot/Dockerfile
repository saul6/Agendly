FROM node:20-alpine
WORKDIR /app
COPY package*.json tsconfig.json ./
COPY src ./src
RUN npm install && npx --yes tsc
EXPOSE 8080
CMD ["node", "dist/index.js"]
