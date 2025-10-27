// NewsSIL Boost Bot – v4.2b-clean
// Requires: Node 18+, Telegraf 4.x
import 'dotenv/config.js';
import { Telegraf } from 'telegraf';
import * as fsp from 'fs/promises';
import fs from 'fs';
import path from 'path';

// ---------- ENV guard ----------
const need = (k) => {
  const v = process.env[k];
  if (!v || String(v).trim() === '') throw new Error(`Missing env ${k}`);
  return v;
};

// Required
const BOT_TOKEN         = need('BOT_TOKEN');
const TARGET_CHANNEL_ID = need('TARGET_CHANNEL_ID');   // לדוגמה: -1002111890470
const ADMIN_ID          = need('ADMIN_ID');            // המשתמש שלך לבדיקה/פיקוד

// Optional
const SOURCE_CHANNEL_ID = process.env.SOURCE_CHANNEL_ID || ''; // אם רץ כ-channel post handler, אפשר להשאיר ריק
const MAKE_WEBHOOK_URL  = process.env.MAKE_WEBHOOK_URL || '';
const FOOTER_ONELINE    = (process.env.FOOTER_ONELINE || 'חדשות ישראל IL — הצטרפו/תעקבו: X | פייסבוק | אינסטגרם | טיקטוק | וואצאפ').trim();

// Footer links (הטקסט עצמו לחיץ)
const LINK_X  = process.env.LINK_X  || 'https://x.com/newssil?s=21&t=4KCKcrzGOVZp-_w6QjhipQ';
const LINK_FB = process.env.LINK_FB || 'https://www.facebook.com/share/173b9ycBuP/?mibextid=wwXIfr';
const LINK_IG = process.env.LINK_IG || 'https://www.instagram.com/newss_il?igsh=MXNtNjRjcWluc3pmdw==';
const LINK_TT = process.env.LINK_TT || 'https://www.tiktok.com/@newss_il?_t=ZS-90sXDtL1OdD&_r=1';
const LINK_WA = process.env.LINK_WA || 'https://whatsapp.com/channel/0029VaKyMK8ICVfrbqvQ6n0D';

// Watermark controls
const WM_POS     = (process.env.WM_POS || 'corner').toLowerCase(); // corner|topright|center
const WM_CORNER  = process.env.WM_CORNER || 'top-right';           // top-right|top-left|bottom-right|bottom-left
const WM_CENTER  = process.env.WM_CENTER || '0.92,0.10';           // normalized x,y (אם center)
const SEO_ENABLE = (process.env.SEO_ENABLE || 'true').toLowerCase() === 'true';

// Files
const DATA_DIR   = 'data';
const SEEN_FILE  = path.join(DATA_DIR, 'seen.json');

// ---------- helpers ----------
async function ensureDataFile() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    if (!fs.existsSync(SEEN_FILE)) {
      await fsp.writeFile(SEEN_FILE, '[]', 'utf8');
    } else {
      // validate JSON
      const raw = await fsp.readFile(SEEN_FILE, 'utf8');
      JSON.parse(raw || '[]');
    }
  } catch (e) {
    // reset if corrupted
    await fsp.writeFile(SEEN_FILE, '[]', 'utf8');
  }
}

async function readSeen() {
  const raw = await fsp.readFile(SEEN_FILE, 'utf8').catch(()=>'[]');
  try { return JSON.parse(raw || '[]'); } catch { return []; }
}
async function writeSeen(arr) {
  await fsp.writeFile(SEEN_FILE, JSON.stringify(arr.slice(-5000)), 'utf8');
}

function makeFooter() {
  // הטקסט לחיץ: משתמשים ב-MarkdownV2 עם קישורים מוטמעים
  const items = [
    `[X](${LINK_X})`,
    `[פייסבוק](${LINK_FB})`,
    `[אינסטגרם](${LINK_IG})`,
    `[טיקטוק](${LINK_TT})`,
    `[וואצאפ](${LINK_WA})`,
  ];
  // שכבת "SEO" סמויה: מפריד בלתי נראה שלא יוצג
  const INV = SEO_ENABLE ? '\u2063' : ''; // invisible separator
  return `\n${INV}${FOOTER_ONELINE.replaceAll('|','|')}\n${items.join(' | ')}`;
}

function escapeMdV2(s='') {
  // בריחה בסיסית ל-MarkdownV2
  return String(s).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

async function postToMake(payload) {
  if (!MAKE_WEBHOOK_URL) return;
  const body = JSON.stringify(payload);
  for (let i=0;i<4;i++){
    const res = await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body
    }).catch(()=>null);
    const ok = !!(res && res.ok);
    if (ok) return;
    // backoff
    await new Promise(r=>setTimeout(r, 1000*(i+1)));
  }
}

// סימולציית הטבעת ווטרמרק: כאן רק תיאור — בפועל הווטרמרק מופעל בצד ה-Make/FFmpeg/Sharp אם מחוברים.
// אם תרצה עיבוד ישיר בשרת, מחליפים כאן למימוש sharp/ffmpeg.
function buildCaptionWithWM(caption) {
  const wmNote = ''; // לא מציגים טקסט גלוי — הווטרמרק על המדיה עצמה
  return `${caption || ''}${wmNote}${makeFooter()}`;
}

// ---------- Bot ----------
const bot = new Telegraf(BOT_TOKEN, { handlerTimeout: 90_000 });

// פקודת בדיקה
bot.command('ping', async (ctx) => {
  if (String(ctx.from?.id) !== String(ADMIN_ID)) return;
  await ctx.reply('pong');
});

// מאזין לפוסטים של ערוץ
bot.on('channel_post', async (ctx) => {
  try {
    const msg = ctx.channelPost;
    if (!msg) return;

    // מקור/יעד: אם נתת SOURCE_CHANNEL_ID — נוודא שזה ממנו
    if (SOURCE_CHANNEL_ID && String(msg.chat?.id) !== String(SOURCE_CHANNEL_ID)) return;

    await ensureDataFile();
    const seen = await readSeen();
    const key = `${msg.chat.id}:${msg.message_id}`;
    if (seen.includes(key)) return;
    seen.push(key);
    await writeSeen(seen);

    // שלח ל-Make (לוג ותכלס אוטומציות חיצוניות)
    await postToMake({
      event: 'channel_post',
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      has_media: !!(msg.photo || msg.video || msg.animation || msg.document),
      text: msg.text || msg.caption || '',
      ts: Date.now()
    });

    // לוגיקת מדיה מול טקסט
    const baseText = msg.text || msg.caption || '';
    const captionWithFooter = buildCaptionWithWM(escapeMdV2(baseText));

    // 1) אם יש תמונה
    if (msg.photo && msg.photo.length) {
      // מוחק ומעלה מחדש עם כיתוב+פוטר
      try { await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id); } catch {}
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      await ctx.telegram.sendPhoto(
        TARGET_CHANNEL_ID,
        fileId,
        {
          caption: captionWithFooter,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true
        }
      );
      return;
    }

    // 2) אם יש וידאו
    if (msg.video) {
      try { await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id); } catch {}
      await ctx.telegram.sendVideo(
        TARGET_CHANNEL_ID,
        msg.video.file_id,
        {
          caption: captionWithFooter,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true
        }
      );
      return;
    }

    // 3) אנימציה/מסמך — לפי צורך
    if (msg.animation) {
      try { await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id); } catch {}
      await ctx.telegram.sendAnimation(
        TARGET_CHANNEL_ID,
        msg.animation.file_id,
        {
          caption: captionWithFooter,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true
        }
      );
      return;
    }

    if (msg.document) {
      try { await ctx.telegram.deleteMessage(msg.chat.id, msg.message_id); } catch {}
      await ctx.telegram.sendDocument(
        TARGET_CHANNEL_ID,
        msg.document.file_id,
        {
          caption: captionWithFooter,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true
        }
      );
      return;
    }

    // 4) טקסט בלבד → עריכה במקום (צריך שהבוט יהיה מנהל עם Edit permissions), ואם אי אפשר — שולח הודעה חדשה עם הפוטר
    try {
      await ctx.telegram.editMessageText(
        msg.chat.id,
        msg.message_id,
        undefined,
        `${escapeMdV2(baseText)}${makeFooter()}`,
        { parse_mode: 'MarkdownV2', disable_web_page_preview: true }
      );
    } catch {
      await ctx.telegram.sendMessage(
        TARGET_CHANNEL_ID,
        `${escapeMdV2(baseText)}${makeFooter()}`,
        { parse_mode: 'MarkdownV2', disable_web_page_preview: true }
      );
    }
  } catch (err) {
    // טיפול בשגיאות 429 עם לוגים נקיים
    const e = (err && err.response) ? err.response : err;
    console.error('handler error:', e?.error_code || '', e?.description || e?.message || e);
  }
});

// הפעלה
bot.launch()
  .then(() => console.log('newsSIL boost bot started'))
  .catch((e) => console.error('failed to launch bot', e));

// עצירה עדינה (Railway)
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
