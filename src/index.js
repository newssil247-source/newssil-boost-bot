// src/index.js
// NewsSIL Boost Bot — v4.2b (Telegram-only edit; media re-post w/ watermark via Make)
// Requires: Node 18+, Telegraf 4.x

import 'dotenv/config.js';
import fs from 'fs/promises';
import { Telegraf } from 'telegraf';

const {
  BOT_TOKEN,
  TARGET_CHANNEL_ID,
  SOURCE_CHANNEL_ID,              // Optional: אם ריק, מטפל בכל פוסט ביעד
  ADMIN_ID,

  FOOTER_VISIBLE_TG = 'true',
  FOOTER_LINKED = 'true',
  FOOTER_TEXT = 'חדשות ישראל IL — הצטרפו/תעקבו כעת:',
  DISABLE_WEB_PREVIEW = 'true',

  LINK_X,
  LINK_FB,
  LINK_WA,
  LINK_IG,
  LINK_TT,

  SEO_ENABLED = 'true',
  KEYWORDS_PER_POST = '20',

  MAKE_WEBHOOK_URL,              // Webhook ב-Make (FFmpeg overlay + הפצה)
  WM_POS = 'top-right',          // top-right | top-left | bottom-right | bottom-left
  RETRY_BACKOFF_MS = '800',      // בסיס backoff ל-429
  RETRY_ATTEMPTS = '6',          // מקסימום ניסיונות

} = process.env;

// --- Guards ---
const need = (k) => { if (!process.env[k]) throw new Error(`Missing env ${k}`); };
need('BOT_TOKEN'); need('TARGET_CHANNEL_ID');
need('LINK_X'); need('LINK_FB'); need('LINK_WA'); need('LINK_IG'); need('LINK_TT');
need('MAKE_WEBHOOK_URL');

const bot = new Telegraf(BOT_TOKEN, {
  handlerTimeout: 60_000,
});

const SEEN_FILE = 'data/seen.json';

// ---------- Utils ----------
async function loadSeen() {
  try {
    const raw = await fs.readFile(SEEN_FILE, 'utf8');
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [];
  } catch {
    await fs.mkdir('data', { recursive: true });
    await fs.writeFile(SEEN_FILE, '[]', 'utf8');
    return [];
  }
}

async function saveSeen(arr) {
  const safe = Array.isArray(arr) ? arr : [];
  await fs.writeFile(SEEN_FILE, JSON.stringify(safe), 'utf8');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withRetry(fn, label = 'call', max = Number(RETRY_ATTEMPTS)) {
  let attempt = 0;
  while (true) {
    try { return await fn(); }
    catch (err) {
      const code = err?.on?.response?.error_code || err?.code;
      const desc = err?.on?.response?.description || err?.message || '';
      const retryAfter = err?.on?.response?.parameters?.retry_after;
      const is429 = Number(code) === 429 || /Too Many Requests/i.test(desc);
      if (attempt >= max || !is429) throw err;
      const base = Number(RETRY_BACKOFF_MS) || 800;
      const wait = retryAfter ? (retryAfter * 1000) : (base * Math.pow(1.6, attempt));
      attempt++;
      await sleep(wait);
    }
  }
}

// ---------- Footer builders ----------
function buildLinkedFooter() {
  const parts = [];
  if (FOOTER_TEXT?.trim()) parts.push(FOOTER_TEXT.trim());
  const links = [
    ['X', LINK_X],
    ['פייסבוק', LINK_FB],
    ['וואצאפ', LINK_WA],
    ['אינסטגרם', LINK_IG],
    ['טיקטוק', LINK_TT],
  ].filter(([, href]) => !!href);

  const html = links.map(([label, href]) => `<a href="${href}">${label}</a>`).join(' | ');
  parts.push(html);
  return parts.join(' ');
}

function hiddenLinksAnchor() {
  // Invisible anchors (Zero-Width Space) – for SEO/algorithms; לא נראה לעין
  const ZW = '&#8203;';
  const urls = [LINK_X, LINK_FB, LINK_WA, LINK_IG, LINK_TT].filter(Boolean);
  return urls.map(u => `<a href="${u}">${ZW}</a>`).join('');
}

function buildSEOHiddenKeywords(keywords) {
  if (!keywords?.length) return '';
  const ZW = '&#8203;';
  // מטמיעים כעוגנים "ריקים" עם פרמטר — לא נראה לעין
  return keywords.map(kw =>
    `<a href="https://t.me/newssil?q=${encodeURIComponent(kw)}">${ZW}</a>`
  ).join('');
}

let KW_POOL = [];
async function loadKeywordsOnce() {
  if (KW_POOL.length) return;
  try {
    const raw = await fs.readFile('assets/keywords.txt', 'utf8');
    KW_POOL = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  } catch { KW_POOL = []; }
}

function drawKeywords(n) {
  if (!KW_POOL.length || !n) return [];
  const k = Math.min(n, KW_POOL.length);
  const pick = new Set();
  while (pick.size < k) {
    pick.add(KW_POOL[Math.floor(Math.random() * KW_POOL.length)]);
  }
  return [...pick];
}

// ---------- Content policy ----------
function isServiceMessage(msg) {
  // דילוג על נעיצות/הצטרפויות/סקרים/עריכות מערכתיות
  return Boolean(
    msg?.pinned_message ||
    msg?.new_chat_members ||
    msg?.left_chat_member ||
    msg?.new_chat_title ||
    msg?.new_chat_photo ||
    msg?.delete_chat_photo ||
    msg?.group_chat_created ||
    msg?.supergroup_chat_created ||
    msg?.channel_chat_created ||
    msg?.message_auto_delete_timer_changed ||
    msg?.migrate_to_chat_id ||
    msg?.migrate_from_chat_id ||
    msg?.poll
  );
}

function hasOnlyHashtags(text) {
  if (!text) return false;
  const pure = text.replace(/\s/g, '');
  return /^#/.test(pure) && !/[^\u0023\u05d0-\u05ea0-9A-Za-z_]/.test(pure.replace(/#/g, ''));
}

// ---------- Telegram Ops ----------
async function editCaptionOrText(ctx, chatId, messageId, baseText) {
  const disablePreview = String(DISABLE_WEB_PREVIEW).toLowerCase() === 'true';
  const linked = String(FOOTER_LINKED).toLowerCase() === 'true';
  const showFooter = String(FOOTER_VISIBLE_TG).toLowerCase() === 'true';

  let text = baseText || '';

  // הימנעות מפוטר כאשר יש רק האשטגים
  const shouldSkipFooter = hasOnlyHashtags(text);

  // הוספת פוטר לחיץ
  if (showFooter && !shouldSkipFooter) {
    const footer = linked ? buildLinkedFooter() : (FOOTER_TEXT?.trim() || '');
    if (footer) text = `${text}\n\n${footer}`;
  }

  // שכבת SEO סמויה
  if (String(SEO_ENABLED).toLowerCase() === 'true') {
    await loadKeywordsOnce();
    const kws = drawKeywords(Number(KEYWORDS_PER_POST) || 20);
    const layer = hiddenLinksAnchor() + buildSEOHiddenKeywords(kws);
    text = `${text}\n${layer}`;
  }

  const opts = {
    parse_mode: 'HTML',
    disable_web_page_preview: disablePreview,
  };

  // ננסה עריכת כיתוב; אם אין מדיה—עריכת טקסט
  try {
    return await withRetry(() =>
      ctx.telegram.editMessageCaption(chatId, messageId, undefined, text, opts)
    , 'editCaption');
  } catch (e) {
    // אם אין caption לעריכה (פוסט טקסטואלי)
    return await withRetry(() =>
      ctx.telegram.editMessageText(chatId, messageId, undefined, text, opts)
    , 'editText');
  }
}

async function repostMediaWithWatermarkAndFooter(ctx, orig) {
  // שולחים ל-Make לצורך ווטרמרק + הפצה; מצפים ל-URL חוזר
  const payload = {
    action: 'watermark_and_broadcast',
    wm_pos: WM_POS,
    target_channel_id: TARGET_CHANNEL_ID,
    message: sanitizeMessageForMake(orig),
  };

  // מחיקת המקור (לאחר שנקבל אישור Make שה-URL מוכן נעלה חדש)
  await withRetry(() =>
    ctx.telegram.deleteMessage(orig.chat.id, orig.message_id)
  , 'deleteOriginal');

  // קריאה ל-Make
  const res = await fetch(MAKE_WEBHOOK_URL, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(payload),
  }).then(r => r.json()).catch(() => null);

  if (!res || !res.ok || !res.file || !res.type) {
    // fallback: נעלה את אותו מדיה בלי ווטרמרק
    return await sendMediaFallback(ctx, orig);
  }

  // שליחת המדיה המעובדת בחזרה לערוץ היעד עם פוטר ו-SEO
  const baseCaption = getBaseTextFromMessage(orig);
  const caption = await buildCaptionWithFooterAndSEO(baseCaption);

  switch (res.type) {
    case 'photo':
      return await withRetry(() => ctx.telegram.sendPhoto(TARGET_CHANNEL_ID, res.file, {
        caption, parse_mode: 'HTML', disable_web_page_preview: true
      }), 'sendPhoto');
    case 'video':
      return await withRetry(() => ctx.telegram.sendVideo(TARGET_CHANNEL_ID, res.file, {
        caption, parse_mode: 'HTML', disable_web_page_preview: true
      }), 'sendVideo');
    case 'animation':
      return await withRetry(() => ctx.telegram.sendAnimation(TARGET_CHANNEL_ID, res.file, {
        caption, parse_mode: 'HTML', disable_web_page_preview: true
      }), 'sendAnimation');
    case 'document':
      return await withRetry(() => ctx.telegram.sendDocument(TARGET_CHANNEL_ID, res.file, {
        caption, parse_mode: 'HTML', disable_web_page_preview: true
      }), 'sendDocument');
    default:
      return await sendMediaFallback(ctx, orig);
  }
}

function sanitizeMessageForMake(m) {
  const base = getBaseTextFromMessage(m);
  return {
    chat_id: m.chat.id,
    message_id: m.message_id,
    date: m.date,
    media: pickMedia(m),
    caption: base,
  };
}

function pickMedia(m) {
  if (m.photo?.length) return { kind: 'photo', file_id: m.photo.at(-1).file_id };
  if (m.video) return { kind: 'video', file_id: m.video.file_id };
  if (m.animation) return { kind: 'animation', file_id: m.animation.file_id };
  if (m.document) return { kind: 'document', file_id: m.document.file_id };
  return null;
}

function getBaseTextFromMessage(m) {
  return m?.caption || m?.text || '';
}

async function buildCaptionWithFooterAndSEO(base) {
  let text = base || '';
  const linked = String(FOOTER_LINKED).toLowerCase() === 'true';
  const showFooter = String(FOOTER_VISIBLE_TG).toLowerCase() === 'true';
  const skipFooter = hasOnlyHashtags(text);

  if (showFooter && !skipFooter) {
    const footer = linked ? buildLinkedFooter() : (FOOTER_TEXT?.trim() || '');
    if (footer) text = `${text}\n\n${footer}`;
  }

  if (String(SEO_ENABLED).toLowerCase() === 'true') {
    await loadKeywordsOnce();
    const kws = drawKeywords(Number(KEYWORDS_PER_POST) || 20);
    const layer = hiddenLinksAnchor() + buildSEOHiddenKeywords(kws);
    text = `${text}\n${layer}`;
  }

  // חיתוך בטיחותי למגבלות טלגרם (כיתוב מדיה ~1024 תווים)
  if (text.length > 1000) text = text.slice(0, 980) + '…';
  return text;
}

async function sendMediaFallback(ctx, orig) {
  const caption = await buildCaptionWithFooterAndSEO(getBaseTextFromMessage(orig));
  const media = pickMedia(orig);
  if (!media) return;

  const opts = { caption, parse_mode: 'HTML', disable_web_page_preview: true };
  switch (media.kind) {
    case 'photo':
      return await withRetry(() => ctx.telegram.sendPhoto(TARGET_CHANNEL_ID, media.file_id, opts));
    case 'video':
      return await withRetry(() => ctx.telegram.sendVideo(TARGET_CHANNEL_ID, media.file_id, opts));
    case 'animation':
      return await withRetry(() => ctx.telegram.sendAnimation(TARGET_CHANNEL_ID, media.file_id, opts));
    case 'document':
      return await withRetry(() => ctx.telegram.sendDocument(TARGET_CHANNEL_ID, media.file_id, opts));
  }
}

// ---------- Handlers ----------
bot.on(['channel_post', 'edited_channel_post'], async (ctx) => {
  const msg = ctx.update.channel_post || ctx.update.edited_channel_post;
  if (!msg || isServiceMessage(msg)) return;

  // מטפל רק בערוץ היעד (עריכה בלבד בטלגרם)
  if (String(msg.chat.id) !== String(TARGET_CHANNEL_ID)) return;

  // סינון מקור אם ביקשת (למשל: רק אם מקור = SOURCE_CHANNEL_ID)
  if (SOURCE_CHANNEL_ID && msg.forward_from_chat) {
    if (String(msg.forward_from_chat.id) !== String(SOURCE_CHANNEL_ID)) return;
  }

  // אנטי-דופליקייט
  const seen = await loadSeen();
  const key = `${msg.chat.id}:${msg.message_id}`;
  if (seen.includes(key)) return;
  seen.push(key);
  // שמירה עם גג 5000
  if (seen.length > 5000) seen.splice(0, seen.length - 4000);
  await saveSeen(seen);

  // טקסט → עריכה במקום | מדיה → מחיקה+פרסום מחדש עם WM דרך Make
  if (msg.photo || msg.video || msg.animation || msg.document) {
    await repostMediaWithWatermarkAndFooter(ctx, msg);
  } else {
    const base = getBaseTextFromMessage(msg);
    await editCaptionOrText(ctx, msg.chat.id, msg.message_id, base);
  }

  // טריגר נוסף ל-Make להפצה לרשתות (לא תלוי במדיה / טקסט)
  try {
    await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        action: 'broadcast_only',
        target_channel_id: TARGET_CHANNEL_ID,
        message: sanitizeMessageForMake(msg),
      }),
    });
  } catch {}
});

// פקודת בדיקה למנהל
bot.command('ping', async (ctx) => {
  if (String(ctx.from?.id) !== String(ADMIN_ID)) return;
  await ctx.reply('pong');
});

// ---------- Start ----------
bot.launch().then(() => {
  console.log('newsSIL boost bot started.');
}).catch((e) => {
  console.error('failed to launch bot', e);
});

// Graceful stop (Railway)
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
