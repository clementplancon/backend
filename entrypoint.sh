#!/bin/sh

echo "Attente de la base de données..."
until node -e "require('net').createConnection(5432, 'db').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"; do
  sleep 1
done

echo "DB prête, migration en cours..."
npx prisma migrate deploy

echo "Lancement du backend NestJS..."
npm run start:prod
