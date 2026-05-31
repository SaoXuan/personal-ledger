FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p /app/data

ENV PORT=3000
ENV DB_PATH=/app/data/ledger.db

EXPOSE 3000

CMD ["npm", "start"]
