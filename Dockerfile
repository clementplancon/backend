FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx prisma generate
RUN npm run build
RUN npx prisma generate

ENTRYPOINT ["/app/entrypoint.sh"]
