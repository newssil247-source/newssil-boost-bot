// src/index.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.TARGET_CHANNEL_ID;

if (!BOT_TOKEN || !CHANNEL_ID) {
  console.error('❌ Missing BOT_TOKEN or TARGET_CHANNEL_ID in Railway Variables');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('🚀 Bot started. VERIFY ADMIN rights in your channel');

const FOLLOW_LINE =
  '\nחדשות ישראל IL — הצטרפו/תעקבו: ' +
  '[X](https://did.li/News-x) | ' +
  '[פייסבוק](https://did.li/facebook-IL) | ' +
  '[אינסטגרם](https://www.instagram.com/newss_il?igsh=MXNtNjRjcWluc3pmdw==&utm_source=qr) | ' +
  '[טיקטוק](https://did.li/tiktok-IL)';

const SKIP_IF_HAS_HASHTAG = true;
const MAX_CAPTION = 1024;

function addFollowLine(text) {
  const t = (text || '').trim();
  if (!t) return t;
  if (t.includes('חדשות ישראל IL — הצטרפו/תעקבו')) return t;
  if (SKIP_IF_HAS_HASHTAG && /(^|\s)#\S+/u.test(t)) return t;
  return (t + FOLLOW_LINE).slice(0, 4096);
}

async function rewritePost(msg) {
  if (!msg.chat || msg.chat.id.toString() !== CHANNEL_ID.toString()) return;
  if (msg.from?.is_bot) return;

  const chatId = msg.chat.id;
  const messageId = msg.message_id;

  const isPhoto = !!msg.photo;
  const isVideo = !!msg.video;
  const isAnim = !!msg.animation;
  const isDoc = !!msg.document;
  const isMedia = isPhoto || isVideo || isAnim || isDoc;

  const originalText = (msg.caption || msg.text || '').trim();
  if (!originalText) return;

  const finalText = addFollowLine(originalText);
  if (finalText === originalText) return;

  try {
    await bot.deleteMessage(chatId, messageId);

    if (!isMedia) {
      await bot.sendMessage(chatId, finalText, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });
    } else if (isPhoto) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      await bot.sendPhoto(chatId, fileId, {
        caption: finalText.slice(0, MAX_CAPTION),
        parse_mode: 'Markdown'
      });
    } else if (isVideo) {
      await bot.sendVideo(chatId, msg.video.file_id, {
        caption: finalText.slice(0, MAX_CAPTION),
        parse_mode: 'Markdown',
        supports_streaming: true
      });
    } else if (isAnim) {
      await bot.sendAnimation(chatId, msg.animation.file_id, {
        caption: finalText.slice(0, MAX_CAPTION),
        parse_mode: 'Markdown'
      });
    } else if (isDoc) {
      await bot.sendDocument(chatId, msg.document.file_id, {
        caption: finalText.slice(0, MAX_CAPTION),
        parse_mode: 'Markdown'
      });
    }

    console.log('✅ REWROTE post with links ✔');
  } catch (err) {
    console.error('❌ Rewrite failed:', err?.response?.body || err.message || err);
  }
}

bot.on('channel_post', rewritePost);
bot.on('message', (m) => {
  if (m.chat?.type === 'channel') rewritePost(m);
});

bot.onText(/\/status/, (msg) => {
  bot.sendMessage(msg.chat.id, '✅ רץ — שכתוב פוסטים עם קישורים מוטמעים', {
    parse_mode: 'Markdown'
  });
});
