FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /app/data /app/backups && chown node:node /app/data /app/backups
USER node
ENV BIND=0.0.0.0 PORT=4310 DB_PATH=/app/data/taskmanager.sqlite BACKUP_DIR=/app/backups
EXPOSE 4310
CMD ["node", "server.mjs"]
