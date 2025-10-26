FROM node:20-alpine

WORKDIR /app

# מעתיק את קבצי הבוט בלבד
COPY bot/package*.json ./
RUN npm install --production || npm install
COPY bot/ .

# תיקיית data לשמירת seen.json
RUN mkdir -p /app/data

CMD ["npm", "start"]
