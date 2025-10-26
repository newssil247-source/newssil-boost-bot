# Telegram Search Boost Bot (NewsIL)

בוט לקידום ערוץ טלגרם לראש תוצאות החיפוש באמצעות:
- הוספת מילות מפתח והאשטגים לכל פוסט
- רענון חכם של הפוסט הראשון (Pin/Unpin/Copy)
- הפצה לערוצי שותפים
- ניטור מתחרים והתאמת תגיות
- דו"חות KPI יומיים

> **חשוב:** ודא שהבוט הוא ADMIN בערוץ עם הרשאות: Post, Pin, Delete.

---

## 1) הגדרת מזהים
1. **TARGET_CHANNEL_ID**  
   - שלח הודעה בערוץ שלך.
   - העבר את ההודעה לבוט @RawDataBot וקבל את ה-chat_id (לרוב בפורמט `-100XXXXXXXXXX`).
2. **FIRST_POST_MESSAGE_ID**  
   - בחר פוסט חזק מהערוץ -> Share Link.
   - הספרה בסוף הקישור היא ה-message_id (למשל `42`).
3. **OWNER_TELEGRAM_ID**  
   - פתח צ'אט עם @userinfobot וקבל את ה-User ID שלך.

מלא את הערכים בקובץ `.env` (ראה `.env.example`).

---

## 2) התקנה מקומית
```bash
cp .env.example .env   # מלא את הערכים
npm install
npm run start
```

פקודות ניהול:
- `/status` – סטטוס
- `/boost` – ריענון ידני של הפוסט הראשון + הפצה לשותפים
- `/kpi` – דו"ח KPI יומי מיידי

---

## 3) פריסה ל-Google Cloud Run (מומלץ)
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/tg-boost-bot
gcloud run deploy tg-boost-bot   --image gcr.io/YOUR_PROJECT_ID/tg-boost-bot   --platform managed   --region europe-west1   --allow-unauthenticated   --set-env-vars BOT_TOKEN=xxx,TARGET_CHANNEL_ID=-100xxx,FIRST_POST_MESSAGE_ID=xx,OWNER_TELEGRAM_ID=xxx,CRON_TZ=Asia/Jerusalem,REFRESH_EVERY_MINUTES=180,COMPETITOR_SCAN_EVERY_MINUTES=360,KPI_REPORT_HOUR=23,ENABLE_PARTNER_FORWARD=true,PARTNER_CHANNEL_IDS=
```

> טיפ: הגדר מינימום מופעים = 1 (לשמירה על תזמונים), והשתמש ב-`SAFE_MODE=true` כדי למנוע Rate Limit.

---

## 4) אופטימיזציית ערוץ (ידני)
- **שם ערוץ (Title):** `חדשות ישראל iL | NewsIL – עדכונים חיים`
- **תיאור (Bio):** `עדכוני חדשות בזמן אמת: פוליטיקה, ביטחון, כלכלה וטכנולוגיה. פרשנות יומית, פאנלים, ודיווחים מהשטח. Israel News, Breaking, Live.`
- **תמונת פרופיל:** השתמש בלוגו `assets/logo_il.svg` או `assets/logo_il.png`.

---

## 5) אזהרת אבטחה
הקפד לשמור את ה-TOKEN בסוד. אם נחשף בטעות – בטל והנפק חדש דרך BotFather.
