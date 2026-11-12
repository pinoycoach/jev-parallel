# Cloud Run image. No dependencies to install: the app is Node's http module and one HTML file.
FROM node:22-slim
WORKDIR /app
RUN chown node:node /app
COPY --chown=node:node . .
ENV NODE_ENV=production
USER node
CMD ["node", "server.js"]
