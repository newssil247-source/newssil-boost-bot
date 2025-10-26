// src/index.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.TARGET_CHANNEL_ID;

if (!BOT_TOKEN || !CHANNEL_ID) {
  console.error('Missing BOT_TOKEN or TARGET_CHANNEL_ID env vars');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('🚀 Bot started. Make sure the bot is ADMIN in your channel.');

// קישור מוטמע בשורה אחת
const FOLLOW_LINKS =
  '\nחדשות ישראל IL — הצטרפו/תעקבו: ' +
  '[X](https://did.li/News-x) | ' +
  '[פייסבוק](https://did.li/facebook-IL) | ' +
  '[אינסטגרם](https://www.instagram.com/newss_il?igsh=MXNtNjRjcWluc3pmdw==&utm_source=qr) | ' +
  '[טיקטוק](https://did.li/tiktok-IL)';

// האם לדלג אם יש האשטג (#) בטקסט
const SKIP_IF_HAS_HASHTAG = true;

// פונקציה שמטפלת בפוסט מהערוץ
async function handleChannelPost(msg) {
  try {
    if (!msg.chat || msg.chat.id.toString() !== CHANNEL_ID.toString()) return;

    const messageId = msg.message_id;
    const isMedia = !!(msg.photo  msg.video  msg.document || msg.animation);
    const originalText = (msg.caption  msg.text  '').trim();

    // לא לגעת בהודעות בלי טקסט בכלל (טלגרם מגביל עריכת כיתוב למדיה ל-1024 תווים)
    if (!originalText) return;

    // לא להוסיף פעמיים
    if (originalText.includes('חדשות ישראל IL — הצטרפו/תעקבו')) return;

    // דילוג אם יש האשטג בטקסט (לפי הדרישה שלך)
    if (SKIP_IF_HAS_HASHTAG && /(^|\s)#\S+/u.test(originalText)) return;

    const finalText = originalText + FOLLOW_LINKS;

    if (isMedia) {
      await bot.editMessageCaption(finalText, {
        chat_id: CHANNEL_ID,
        message_id: messageId,
        parse_mode: 'Markdown',
      });
    } else {
      await bot.editMessageText(finalText, {
        chat_id: CHANNEL_ID,
        message_id: messageId,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });
    }

    console.log('✅ Added follow links to message:', messageId);
  } catch (err) {
    console.error('❌ Edit failed:', err?.response?.body  err.message  err);
  }
}

// עדכונים מהערוץ מגיעים כ-channel_post; נשאיר גם message ליתר ביטחון
bot.on('channel_post', handleChannelPost);
bot.on('message', (m) => {
  if (m.chat && m.chat.type === 'channel') handleChannelPost(m);
});

// /status לבדיקת חיים
bot.onText(/\/status/, (msg) => {
  bot.sendMessage(msg.chat.id, 'רץ ✅\nהבוט מוסיף קישורים מוטמעים לכל פוסט בלי האשטגים.', {
    parse_mode: 'Markdown',
  });
});
