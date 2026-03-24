FROM ghcr.io/puppeteer/puppeteer:21.6.1

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY server.js .

ENV PORT=3845
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

EXPOSE 3845

CMD ["node", "server.js"]
