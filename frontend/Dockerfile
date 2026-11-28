# syntax=docker/dockerfile:1.7
FROM node:22-alpine

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json frontend/
COPY frontend frontend

WORKDIR /app/frontend
RUN npm ci
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
