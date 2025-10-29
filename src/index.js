// ========= NewsSIL Boost Bot =========
// Version: v6.3 – WM top-right • Edit-in-place (fallback) • Albums no-gap • Compressed video • Footer A • Make fanout
// Patched: stable per-message dedup + atomic seen store + proper album-level dedup

import 'dotenv/config.js';
import { Telegraf } from 'telegraf';
import fs from 'fs/promises';
import fssync from 'fs';
import axios from 'axios';
import { spawn } from 'child_process';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import crypto from 'crypto';

// ======== ENV helpers ========
const need = (k) => { const v = process.env[k]; if (!v || String(v).trim()==='') throw new Error(`Missing env ${k}`); return v; };
const bool = (v, d='true') => String(v ?? d) === 'true';
const num  = (v, d) => Number(v ?? d);

// ======== Telegram / Behavior ========
const BOT_TOKEN             = need('BOT_TOKEN');
const SOURCE_CHANNEL_ID     = need('SOURCE_CHANNEL_ID'); // ערוץ המקור (ועליו עובדים)
const DISABLE_WEB_PREVIEW   = bool(process.env.DISABLE_WEB_PREVIEW, 'true');

// ======== Footer =========
const FOOTER_VISIBLE_TG     = bool(process.env.FOOTER_VISIBLE_TG, 'true');
const FOOTER_LINKED         = bool(process.env.FOOTER_LINKED, 'true');
const SKIP_FOOTER_IF_HASHTAG= bool(process.env.SKIP_FOOTER_IF_HASHTAG, 'true');

const LINK_X  = need('LINK_X');
const LINK_FB = need('LINK_FB');
const LINK_WA = need('LINK_WA');
const LINK_IG = need('LINK_IG');
const LINK_TT = need('LINK_TT');

// ======== Watermark =========
const WM_ENABLE    = bool(process.env.WM_ENABLE, 'true');
const WM_IMAGE     = process.env.WM_IMAGE || 'assets/il_logo.png';
const WM_POS       = process.env.WM_POS || 'top-right';
const WM_MARGIN    = num(process.env.WM_MARGIN, 20);
const WM_WIDTH_PCT = num(process.env.WM_WIDTH_PCT, 18);

// ======== Albums =========
const GROUP_COMBINE_ENABLE = bool(process.env.GROUP_COMBINE_ENABLE, 'true');
const GROUP_BUFFER_MS      = num(process.env.GROUP_BUFFER_MS, 1200);

// ======== Make (optional) =========
const MAKE_WEBHOOK_URL     = process.env.MAKE_WEBHOOK_URL || '';

// ======== Seen store =========
const SEEN_FILE = process.env.SEEN_FILE || 'data/seen.json';
const SEEN_LOCK = process.env.SEEN_LOCK || 'data/seen.lock';
if (!fssync.existsSync('data')) fssync.mkdirSync('data', { recursive: true });
if (!fssync.existsSync(SEEN_FILE)) fssync.writeFileSync(SEEN_FILE, '[]');

// ======== Bot =========
const bot = new Telegraf(BOT_TOKEN);

// ======== Utils (dedup) =========
// מזהה יציב לפר הודעה; לא משתמשים ב-media_group_id כדי לא לחסום פריטי אלבום
function messageFingerprint(msg) {
  if (msg?.message_id && msg?.chat?.id) {
    return `m:${msg.chat.id}:${msg.message_id}`;
  }
  const fileUid =
    msg.photo?.[msg.photo.length - 1]?.file_unique_id ||
    msg.video?.file_unique_id ||
    msg.document?.file_unique_id ||
    msg.animation?.file_unique_id ||
    msg.audio?.file_unique_id;

  if (fileUid) return `f:${msg.chat?.id}:${fileUid}`;

  const baseText = (msg.caption || msg.text || '').trim();
  const created  = msg.date || 0; // יוניקס שניות
  const h = crypto.createHash('sha1')
                  .update(`${msg.chat?.id}|${baseText}|${created}`)
                  .digest('hex')
                  .slice(0, 16);
  return `t:${msg.chat?.id}:${h}`;
}

// "נעילה" פשטנית על קובץ כדי למנוע מרוץ בין אינסטנסים
async function acquireSeenLock(retries = 60, delayMs = 25) {
  for (let i = 0; i < retries; i++) {
    try {
      const fd = fssync.openSync(SEEN_LOCK, 'wx'); // ייכשל אם קיים
      return fd;
    } catch {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('seen lock timeout');
}

async function seenPush(key, keep = 4000) {
  let lockFd;
  try {
    lockFd = await acquireSeenLock();
    let arr = [];
    try {
      const raw = await fs.readFile(SEEN_FILE, 'utf8');
      arr = JSON.parse(raw || '[]');
    } catch { arr = []; }

    if (arr.includes(key)) return false;
    arr.push(key);
    if (arr.length > keep) arr = arr.slice(-keep);
    await fs.writeFile(SEEN_FILE, JSON.stringify(arr));
    return true;
  } finally {
    if (lockFd != null) {
      try { fssync.closeSync(lockFd); } catch {}
      try { fssync.unlinkSync(SEEN_LOCK); } catch {}
    }
  }
}

function hasHashtag(s=''){ return /(^|\s)#\w+/u.test(String(s)); }

function buildFooter() {
  if (!FOOTER_VISIBLE_TG) return '';
  const header = 'חדשות ישראל IL — עקבו אחרינו:';
  const links = FOOTER_LINKED
    ? `<a href="${LINK_X}">X</a> | <a href="${LINK_FB}">Facebook</a> | <a href="${LINK_WA}">WhatsApp</a> | <a href="${LINK_IG}">Instagram</a> | <a href="${LINK_TT}">TikTok</a>`
    : `X | Facebook | WhatsApp | Instagram | TikTok`;
  return `${header}\n${links}`;
}

function wmOverlayExpr() {
  // כרגע תומכים top-right בלבד (ניתן להרחבה)
  return `W-w-${WM_MARGIN}:${WM_MARGIN}`;
}

async function fanoutToMake(payload) {
  if (!MAKE_WEBHOOK_URL) return;
  try {
    await axios.post(MAKE_WEBHOOK_URL, payload, { headers: {'content-type':'application/json'} });
  } catch (e) {
    console.warn('make webhook error:', e?.message || e);
  }
}

// -------- Downloads ----------
async function downloadFile(tg, fileId, dest) {
  const link = await tg.getFileLink(fileId);
  const r = await axios.get(link.href, { responseType: 'arraybuffer' });
  await fs.writeFile(dest, r.data);
  return dest;
}

// -------- Watermark: Image ----------
async function watermarkImage(input, output) {
  const sharp = (await import('sharp')).default;
  const img = sharp(input);
  const meta = await img.metadata();
  const width = meta.width || 1280;
  const wmW = Math.round(width * WM_WIDTH_PCT / 100);

  const wm = await sharp(WM_IMAGE).resize({ width: wmW }).png().toBuffer();

  await img
    .composite([{ input: wm, left: (width - wmW - WM_MARGIN), top: WM_MARGIN }])
    .jpeg({ quality: 85 })
    .toFile(output);

  return output;
}

// -------- Watermark: Video (compressed, quality-first) ----------
async function watermarkVideo(input, output) {
  return new Promise((res, rej) => {
    const vfScale = `scale='min(1280,iw)':-2,format=yuv420p`;
    const overlay  = wmOverlayExpr();

    const args = [
      '-y',
      '-i', input,
      '-i', WM_IMAGE,
      '-filter_complex',
      `[1][0]scale2ref=w=iw*${WM_WIDTH_PCT/100}:h=ow/mdar[wm][vid];[vid]${vfScale}[v1];[v1][wm]overlay=${overlay}`,
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-preset', 'veryfast',
      '-crf', '27',
      '-maxrate', '3M',
      '-bufsize', '6M',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      output
    ];

    const ff = spawn(ffmpegPath, args);
    ff.on('error', rej);
    ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)));
  });
}

// -------- Media detectors ----------
function detectMedia(msg) {
  if (msg.video)     return { kind: 'video', fileId: msg.video.file_id,      ext: '.mp4' };
  if (msg.animation) return { kind: 'video', fileId: msg.animation.file_id,  ext: '.mp4' }; // GIF/MP4
  if (msg.photo?.length) return { kind: 'image', fileId: msg.photo.at(-1).file_id, ext: '.jpg' };
  if (msg.document) {
    const mime = msg.document.mime_type || '';
    if (mime.startsWith('image/')) return { kind: 'image', fileId: msg.document.file_id, ext: '.jpg' };
    if (mime.startsWith('video/')) return { kind: 'video', fileId: msg.document.file_id, ext: '.mp4' };
  }
  return null;
}

// -------- Albums buffer ----------
const groups = new Map(); // key: media_group_id → { items: [], chatId, timer }

// ======== Bot logic =========
bot.on('channel_post', async ctx => {
  const msg = ctx.channelPost;
  if (!msg?.chat?.id) return;
  if (String(msg.chat.id) !== String(SOURCE_CHANNEL_ID)) return;

  // אלבום? לא עושים דה-דופליקציה כאן, רק אוספים ורצים בטיימר עם key קבוצתי
  if (GROUP_COMBINE_ENABLE && msg.media_group_id) {
    const gid = msg.media_group_id;
    if (!groups.has(gid)) groups.set(gid, { items: [], chatId: msg.chat.id, timer: null });
    const g = groups.get(gid);
    g.items.push({ msg, baseText: msg.caption || msg.text || '' });

    if (g.timer) clearTimeout(g.timer);
    g.timer = setTimeout(async () => {
      const groupKey = `group:${g.chatId}:${gid}`;
      if (!await seenPush(groupKey)) { groups.delete(gid); return; }

      try { await handleAlbum(ctx.telegram, g.items, g.chatId); }
      catch (e){ console.warn('album error:', e?.message || e); }
      finally { groups.delete(gid); }
    }, GROUP_BUFFER_MS);
    return;
  }

  // לא אלבום → דה-דופליקציה פר הודעה
  const key = messageFingerprint(msg);
  if (!await seenPush(key)) return;

  const baseText = msg.caption || msg.text || '';
  const addFooter = FOOTER_VISIBLE_TG && !(SKIP_FOOTER_IF_HASHTAG && hasHashtag(baseText));
  const footer = addFooter ? `\n\n${buildFooter()}` : '';
  const caption = `${baseText}${footer}`.trim();

  // טקסט בלבד או מדיה בודדת
  const media = detectMedia(msg);
  if (!media) {
    // טקסט בלבד → עריכה במקום
    try {
      await ctx.telegram.editMessageText(msg.chat.id, msg.message_id, null, caption, {
        parse_mode: 'HTML',
        disable_web_page_preview: DISABLE_WEB_PREVIEW
      });
      fanoutToMake({ type: 'text_edit', chat_id: msg.chat.id, message_id: msg.message_id, text: caption });
    } catch (e) {
      console.warn('edit text error:', e?.description || e?.message || e);
    }
    return;
  }

  // מדיה בודדת → מכין WM/קובץ ואז מנסה עריכה "בפנים", אחרת מחיקה+שליחה מיידית
  await handleSingleMedia(ctx.telegram, msg, media, caption);
});

async function handleSingleMedia(tg, msg, media, caption) {
  await fs.mkdir('tmp', { recursive: true });
  const base = `${msg.chat.id}_${msg.message_id}_${Date.now()}`;
  const inFile  = `tmp/${base}${media.ext}`;
  const outFile = `tmp/${base}.wm${media.ext}`;

  await downloadFile(tg, media.fileId, inFile);

  let editedFile = inFile;
  try {
    if (WM_ENABLE) {
      if (media.kind === 'video') await watermarkVideo(inFile, outFile);
      else await watermarkImage(inFile, outFile);
      editedFile = outFile;
    }
  } catch (e) {
    console.warn('WM failed (single):', e?.message || e);
  }

  // נסיון ראשון: edit "בפנים" (ללא מחיקה)
  try {
    await tg.editMessageMedia(
      msg.chat.id,
      msg.message_id,
      undefined,
      media.kind === 'video'
        ? { type: 'video', media: { source: editedFile }, caption, parse_mode: 'HTML' }
        : { type: 'photo', media: { source: editedFile },  caption, parse_mode: 'HTML' },
      { disable_web_page_preview: DISABLE_WEB_PREVIEW }
    );
    fanoutToMake({ type: 'media_single_edit', chat_id: msg.chat.id, message_id: msg.message_id });
  } catch (e) {
    // פולבק: מחיקה+שליחה חדשה באופן מיידי (אין חלון ריק — הכל מוכן מראש)
    try { await tg.deleteMessage(msg.chat.id, msg.message_id); } catch {}
    if (media.kind === 'video') {
      await tg.sendVideo(msg.chat.id, { source: editedFile }, {
        caption, parse_mode: 'HTML', disable_web_page_preview: DISABLE_WEB_PREVIEW
      });
    } else {
      await tg.sendPhoto(msg.chat.id, { source: editedFile }, {
        caption, parse_mode: 'HTML', disable_web_page_preview: DISABLE_WEB_PREVIEW
      });
    }
    fanoutToMake({ type: 'media_single_repost', chat_id: msg.chat.id });
  }

  await fs.rm(inFile, { force: true });
  await fs.rm(outFile, { force: true });
}

async function handleAlbum(tg, items, chatId) {
  // 1) מכין את כל הקבצים (WM) מראש
  await fs.mkdir('tmp', { recursive: true });
  const prepared = [];

  for (let i = 0; i < items.length; i++) {
    const { msg, baseText } = items[i];
    const m = detectMedia(msg);
    if (!m) continue;

    const base = `${chatId}_${msg.message_id}_${i}_${Date.now()}`;
    const inFile  = `tmp/${base}${m.ext}`;
    const outFile = `tmp/${base}.wm${m.ext}`;

    await downloadFile(tg, m.fileId, inFile);

    let sendFile = inFile;
    try {
      if (WM_ENABLE) {
        if (m.kind === 'video') await watermarkVideo(inFile, outFile);
        else await watermarkImage(inFile, outFile);
        sendFile = outFile;
      }
    } catch (e) {
      console.warn('WM failed (album item):', e?.message || e);
    }

    const addFooter = FOOTER_VISIBLE_TG && !(SKIP_FOOTER_IF_HASHTAG && hasHashtag(baseText));
    const cap = (i === 0) ? `${baseText}${addFooter ? '\n\n'+buildFooter() : ''}`.trim() : undefined;

    prepared.push(
      m.kind === 'video'
        ? { type: 'video', media: { source: sendFile }, caption: cap, parse_mode: 'HTML' }
        : { type: 'photo', media: { source: sendFile }, caption: cap, parse_mode: 'HTML' }
    );
  }

  if (!prepared.length) return;

  // 2) מוחק את הודעות האלבום הישנות
  for (const it of items) { try { await tg.deleteMessage(chatId, it.msg.message_id); } catch {} }

  // 3) שולח את האלבום כמקשה אחת
  await tg.sendMediaGroup(chatId, prepared, { disable_web_page_preview: DISABLE_WEB_PREVIEW });
  fanoutToMake({ type: 'media_group', chat_id: chatId, count: prepared.length });

  // 4) ניקוי tmp
  try {
    for (const f of await fs.readdir('tmp')) {
      if (/\.(wm\.mp4|wm\.jpg|mp4|jpg)$/i.test(f)) await fs.rm(`tmp/${f}`, { force: true });
    }
  } catch {}
}

// ======== Admin commands ========
bot.command('status', async (ctx) => {
  const txt = `רץ 🟢\nערוץ מקור: ${SOURCE_CHANNEL_ID}\nFanout: ${MAKE_WEBHOOK_URL ? 'ON' : 'OFF'}`;
  try { await ctx.reply(txt); } catch {}
});

bot.command('ping', (ctx) => ctx.reply('pong'));

// ======== Launch ========
bot.launch();
console.log('NewsSIL Boost Bot v6.3 started (patched per-message & album dedup)');

// Graceful stop (Railway)
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
