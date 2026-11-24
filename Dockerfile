# ---------- 1) Compila la app Flutter para web ----------
FROM ghcr.io/cirruslabs/flutter:stable AS web
WORKDIR /app
COPY app/ ./
RUN flutter config --no-analytics >/dev/null 2>&1 || true \
 && flutter create --platforms=web --project-name tienda_app --org co.edu.uniminuto . \
 && flutter pub get \
 && flutter build web --release

# ---------- 2) API Node.js + web de Flutter estática ----------
FROM node:20-slim
WORKDIR /srv
ENV NODE_ENV=production
COPY backend/package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY backend/ ./
COPY --from=web /app/build/web ./public
EXPOSE 3000
CMD ["node", "server.js"]
