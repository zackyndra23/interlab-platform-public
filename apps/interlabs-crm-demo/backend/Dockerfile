FROM node:20-alpine

WORKDIR /app

# Install deps first for layer caching.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY migrations ./migrations
COPY scripts ./scripts

# Entrypoint: wait for postgres, run migrations + seed, then start the API.
# Written inline so the image has no extra shell-script file to track.
RUN printf '#!/bin/sh\nset -e\nnode scripts/wait-for-postgres.js\nnode scripts/migrate.js\nnode scripts/seed.js\nexec node src/app.js\n' > /app/entrypoint.sh \
    && chmod +x /app/entrypoint.sh

EXPOSE 4000

CMD ["/app/entrypoint.sh"]
