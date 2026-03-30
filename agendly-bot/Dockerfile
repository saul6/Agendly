FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
RUN ./node_modules/.bin/tsc --version
COPY . .
RUN ./node_modules/.bin/tsc
EXPOSE 8080
CMD ["node", "dist/index.js"]
