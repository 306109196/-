FROM node:24-alpine

RUN apk add --no-cache su-exec

WORKDIR /app

COPY package.json server.mjs ./
COPY index.html app.html gate.css gate.js styles.css app.js data.js questions.js ./
COPY admin.html admin.css admin.js ./

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /var/data \
    && chown -R node:node /app /var/data

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    DATA_DIR=/var/data \
    COOKIE_SECURE=1

EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4173) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.mjs"]
