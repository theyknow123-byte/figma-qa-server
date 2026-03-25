FROM ghcr.io/puppeteer/puppeteer:21.6.1

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

COPY package.json .
RUN npm install --omit=dev

COPY server.js .

ENV PORT=3845
EXPOSE 3845

CMD ["node", "server.js"]
