FROM node:20-alpine

# Non-root user
RUN addgroup -S app && adduser -S app -G app
USER app

WORKDIR /app

# Dependencies
COPY --chown=app:app package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# App code
COPY --chown=app:app index.js ./
COPY --chown=app:app templates ./templates

# Persisted state
VOLUME ["/app/data"]

ENV DATA_DIR=/app/data
ENV TEMPLATE_PATH=/app/templates/message_template.json
ENV LOG_LEVEL=info

CMD ["node", "index.js"]
