# syntax=docker/dockerfile:1
# Image de production durcie : dépendances de prod uniquement, utilisateur non-root,
# système de fichiers en lecture seule possible (seul /app/data est inscriptible).

# Node 22 LTS : maintenu jusqu'en avril 2027 (passer à node:24-alpine ensuite).
# Astuce : épingle l'image par son empreinte (node:22-alpine@sha256:…) pour des builds
# reproductibles ; Dependabot proposera les mises à jour.
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts : aucun script d'installation tiers n'est exécuté (attaques supply chain)
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

FROM ${NODE_IMAGE}
LABEL org.opencontainers.image.title="Zotracker" \
      org.opencontainers.image.description="Suivi GPS en direct pour courses à pied" \
      org.opencontainers.image.source="https://github.com/cobroux/zotracker"
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data
WORKDIR /app
# Les correctifs du système viennent de l'image de base, reconstruite chaque semaine par la CI.
# npm/yarn/corepack sont inutiles à l'exécution : on les retire (moins de surface d'attaque).
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn* \
 && mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --chown=root:root package.json server.js ./
COPY --chown=root:root lib ./lib
COPY --chown=root:root routes ./routes
COPY --chown=root:root public ./public
# le code appartient à root et n'est pas modifiable par le processus (utilisateur node)
USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
