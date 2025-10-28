// ========= NewsSIL Boost Bot =========
// Version: v6.1 – edit-in-place media WM (top-right), no spoiler, Make fanout

import 'dotenv/config.js';
import { Telegraf } from 'telegraf';
import fs from 'fs/promises';
import fssync from 'fs';
import axios from 'axios';
import { spawn } from 'child_process';
import path from 'path';

// --------- Required ENV ----------
const need = (k) => { const v = process.env[k]; if (!v || String(v).trim()==='') throw new Error(`Missing env ${k}`); return v; };

const BOT_TOKEN         = need('BOT_TOKEN');
const SOURCE_CHANNEL_ID = need('SOURCE_CHANNEL_ID');   // המקור (וגם היעד בתוך טלגרם)
const ADMIN_ID          = need('ADMIN_ID');

// --------- Options / Flags ----------
const DISABLE_WEB_PREVIEW   = String(process.env.DISABLE_WEB_PREVIEW || 'true') === 'true';
const FOOTER_VISIBLE_TG     = String(process.env.FOOTER_VISIBLE_TG || 'true') === 'true';
const FOOTER_LINKED         = String(process.env.FOOTER_LINKED || 'true') === 'true';
const IGNORE_BOT_MESSAGES   = String(process.env.IGNORE_BOT_MESSAGES || 'true') === 'true';

// Footer links (לחיץ)
const LINK_X  = need('LINK_X');
const LINK_FB = need('LINK_FB');
const LINK_WA = need('LINK_WA');
const LINK_IG = need('LINK_IG');
const LINK_TT = need('LINK_TT');

// Watermark config
const WM_ENABLE    = String(process.env.WM_ENABLE || 'true') === 'true';
const WM_IMAGE     = process.env.WM_IMAGE || 'assets/il_logo.png';
const WM_POS       = process.env.WM_POS || 'top-right'; // top-right/bottom-right/bottom-left/top-left
const WM_MARGIN    = Number(process.env.WM_MARGIN || 20);
const WM_WIDTH_PCT = Number(process.env.WM_WIDTH_PCT || 18);

// Make (webhook) fanout
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL || ''; // אופציונלי

// --------- Files / State ----------
const DATA_DIR  = 'data';
const SEEN_FILE = path.join(DATA_DIR, 'seen.json');
if (!fssync.existsSync(DATA_DIR)) fssync.mkdirSync(DATA_DIR, { recursive: true });
if (!fssync.existsSync(SEEN_FILE)) fssync.writeFileSync(SEEN_FILE, '[]');

// --------- Bot ----------
const bot = new Telegraf(BOT_TOKEN);

// ---------- helpers ----------
const SEND_OPTS = {
  parse_mode: 'HTML',
  disable_web_page_preview: DISABLE_WEB_PREVIEW,
  disable_notification: true,
};

async function readSeen() {
  try {
    const raw = await fs.readFile(SEEN_FILE, 'utf8');
    const j = JSON.parse(raw || '[]');
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}
async function writeSeen(arr) {
  await fs.writeFile(SEEN_FILE, JSON.stringify(arr.slice(-4000)));
}

function buildFooterHTML() {
  if (!FOOTER_VISIBLE_TG) return '';
  const header = 'חדשות ישראל IL — עקבו אחרינו:';
  const links = FOOTER_LINKED
    ? `<a href="${LINK_X}">X</a> | <a href="${LINK_FB}">Facebook</a> | <a href="${LINK_WA}">WhatsApp</a> | <a href="${LINK_IG}">Instagram</a> | <a href="${LINK_TT}">TikTok</a>`
    : `X | Facebook | WhatsApp | Instagram | TikTok`;
  return `${header}\n${links}`;
}

function addFooter(text='') {
  const footer = buildFooterHTML();
  const clean  = String(text || '').trim();
  return clean ? `${clean}\n\n${footer}` : footer;
}

async function downloadByFileId(tg, fileId, outPath) {
  const link = await tg.getFileLink(fileId);
  const res  = await axios.get(link.href, { responseType: 'arraybuffer' });
  await fs.writeFile(outPath, res.data);
  return outPath;
}

function overlayExpr(pos, m) {
  const xr = `W-w-${m}`;
  const xl = `${m}`;
  const yt = `${m}`;
  const yb = `H-h-${m}`;
  switch (pos) {
    case 'top-right':    return `${xr}:${yt}`;
    case 'bottom-right': return `${xr}:${yb}`;
    case 'bottom-left':  return `${xl}:${yb}`;
    default:             return `${xl}:${yt}`; // top-left
  }
}

async function wmVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-i', WM_IMAGE,
      '-filter_complex',
      // watermark scale by video width; overlay at desired corner
      `[1][0]scale2ref=w=iw*${WM_WIDTH_PCT/100}:h=ow/mdar[wm][v];[v][wm]overlay=${overlayExpr(WM_POS, WM_MARGIN)}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'copy',
      outputPath
    ]);
    ff.on('error', reject);
    ff.stderr.on('data', d => process.stdout.write(d.toString()));
    ff.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
  });
}

async function wmImage(inputPath, outputPath) {
  const sharp = (await import('sharp')).default;
  const img = sharp(inputPath);
  const meta = await img.metadata();
  const w    = Math.max(100, Math.round((meta.width || 1000) * (WM_WIDTH_PCT / 100)));
  const wm   = await sharp(WM_IMAGE).resize({ width: w }).png().toBuffer();

  let left = WM_MARGIN, top = WM_MARGIN;
  if (WM_POS.includes('right')) left = (meta.width - w - WM_MARGIN);
  if (WM_POS.includes('bottom')) top = (meta.height - Math.round(w * 0.6) - WM_MARGIN);

  await img.composite([{ input: wm, left: Math.max(0,left), top: Math.max(0,top) }])
           .jpeg({ quality: 90 })
           .toFile(outputPath);
  return outputPath;
}

async function makeFanout(payload) {
  if (!MAKE_WEBHOOK_URL) return;
  try {
    await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type':'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn('make fanout failed:', e?.message || e);
  }
}

// ---------- main handler ----------
bot.on('channel_post', async (ctx) => {
  const msg = ctx.channelPost;
  if (!msg?.chat?.id) return;
  if (String(msg.chat.id) !== String(SOURCE_CHANNEL_ID)) return;
  if (IGNORE_BOT_MESSAGES && msg.from?.is_bot) return;

  // אנטי-כפילות
  const seen = await readSeen();
  const key  = `${msg.chat.id}:${msg.message_id}`;
  if (seen.includes(key)) return;
  seen.push(key);
  await writeSeen(seen);

  // כיתוב (פוטר בלבד – אין SEO/ספוילר)
  const base = msg.caption || msg.text || '';
  const caption = addFooter(base);

  const tg = ctx.telegram;

  // --- טקסט בלבד: עריכה "בפנים" ---
  if (!msg.photo && !msg.video && !msg.document && !msg.animation) {
    try {
      await tg.editMessageText(msg.chat.id, msg.message_id, undefined, caption, SEND_OPTS);
      await makeFanout({ type: 'text', chat_id: msg.chat.id, message_id: msg.message_id, text: caption });
    } catch (e) {
      console.error('edit text failed:', e?.response || e);
    }
    return;
  }

  // --- מדיה: עריכה מיידית "בפנים" עם WM ---
  try {
    await fs.mkdir('tmp', { recursive: true });

    // קביעת סוג וקובץ
    const isVideo = !!(msg.video || msg.animation);           // animation = GIF/MP4
    const isDoc   = !!msg.document && !msg.photo && !msg.video && !msg.animation;
    const fileId  = isVideo ? (msg.video?.file_id || msg.animation?.file_id)
                  : msg.photo ? msg.photo[msg.photo.length - 1].file_id
                  : isDoc    ? msg.document.file_id
                  : null;
    if (!fileId) return;

    const tmpIn   = `tmp/${key}.src`;
    const tmpOut  = `tmp/${key}.wm.${isVideo ? 'mp4' : 'jpg'}`;

    await downloadByFileId(tg, fileId, tmpIn);

    if (WM_ENABLE && (msg.photo || msg.video || msg.animation)) {
      isVideo ? await wmVideo(tmpIn, tmpOut) : await wmImage(tmpIn, tmpOut);
    } else {
      await fs.copyFile(tmpIn, tmpOut);
    }

    // editMessageMedia – מחליף מדיה באותה הודעה
    const mediaPayload = isVideo
      ? { type: 'video', media: { source: tmpOut }, caption, parse_mode: 'HTML' }
      : { type: 'photo', media: { source: tmpOut }, caption, parse_mode: 'HTML' };

    await tg.editMessageMedia(msg.chat.id, msg.message_id, undefined, mediaPayload, {
      disable_web_page_preview: DISABLE_WEB_PREVIEW,
    });

    await makeFanout({
      type: isVideo ? 'video' : 'photo',
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      caption,
    });

    await fs.rm(tmpIn, { force: true });
    await fs.rm(tmpOut, { force: true });
  } catch (e) {
    console.error('edit media failed:', e?.response || e);
  }
});

// ----- admin -----
bot.command('ping', (ctx) => { if (String(ctx.chat?.id) === String(ADMIN_ID)) ctx.reply('pong'); });

// launch
bot.launch().then(()=>console.log('NewsSIL bot v6.1 started')).catch(e=>console.error('launch failed', e));

// graceful stop (Railway)
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
