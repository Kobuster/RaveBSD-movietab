# Not pinned by digest, so each release build gets the latest Node 24 and Debian security fixes.
FROM node:24-slim
WORKDIR /app

# The browser is used for Z-Library searches without an account and for Anna's Archive. For a much
# smaller image without it, build with: docker compose build --build-arg WITH_BROWSER=0
ARG WITH_BROWSER=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json ./
RUN if [ "$WITH_BROWSER" = "1" ]; then \
        npm ci --omit=dev --ignore-scripts && npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*; \
    else \
        npm ci --omit=dev --omit=optional --ignore-scripts; \
    fi

# Python 3 runs qBittorrent search plugins dropped into /scrapers/qbt (src/qbtplugins.js). Plugins only need the
# standard library and qBittorrent's helper files, which ship in src/nova.
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*

COPY src ./src
COPY public ./public
RUN chmod -R a+rX /app

# BUILD_ID is the git commit, passed in by the publish workflow. It is shown in the admin panel under System.
ARG BUILD_ID=
# HOME=/tmp: with PUID/PGID set to a user the image does not know, HOME would be /, which the browser cannot write to.
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data BOOKS_DIR=/books AUDIOBOOKS_DIR=/audiobooks MOVIES_DIR=/movies TV_DIR=/tv ANIME_DIR=/anime MUSIC_DIR=/music GAMES_DIR=/games SOFTWARE_DIR=/software PICTURES_DIR=/pictures SCRAPERS_DIR=/scrapers BROWSER_IN_CONTAINER=1 BUILD_ID=$BUILD_ID HOME=/tmp
# /data holds settings and the shelf list, /books ... /pictures hold the files (one folder per tab), /downloads is shared
# with qBittorrent, /scrapers holds your own drop-in scrapers and qBittorrent plugins (read-only).
RUN mkdir /data /books /audiobooks /movies /tv /anime /music /games /software /pictures /scrapers /downloads \
    && chown node:node /data /books /audiobooks /movies /tv /anime /music /games /software /pictures /downloads
USER node
VOLUME ["/data", "/books", "/audiobooks", "/movies", "/tv", "/anime", "/music", "/games", "/software", "/pictures"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/server.js"]
