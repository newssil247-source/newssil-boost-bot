// NewsSIL Boost Bot – v4.2b (media WM + footer + rate-limit)
import 'dotenv/config.js';
import { Telegraf } from 'telegraf';
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import axios from 'axios';
import { spawn } from 'child_process';

const need = (k) => { if (!process.env[k]) throw new Error(`Missing env ${k}`); return process.env[k]; };

const BOT_TOKEN         = need('BOT_TOKEN');
const SOURCE_CHANNEL_ID = need('SOURCE_CHANNEL_ID');
const TARGET_CHANNEL_ID = need('TARGET_CHANNEL_ID');
const ADMIN_ID          = need('ADMIN_ID');

const LINK_X  = need('LINK_X');
const LINK_FB = need('LINK_FB');
const LINK_WA = need('LINK_WA');
const LINK_IG = need('LINK_IG');
const LINK_TT = need('LINK_TT');

const FOOTER_ONELINE = process.env.FOOTER_ONELINE || 'חדשות ישראל IL — הצטרפו/תעקבו כעת';
const DISABLE_WEB_PREVIEW = String(process.env.DISABLE_WEB_PREVIEW || 'true') === 'true';

const WM_ENABLE    = String(process.env.WM_ENABLE || 'true') === 'true';
const WM_IMAGE     = process.env.WM_IMAGE || 'assets/il_logo.png';
const WM_POS       = process.env.WM_POS || 'top-right';
const WM_MARGIN    = Number(process.env.WM_MARGIN || 20);
const WM_WIDTH_PCT = Number(process.env.WM_WIDTH_PCT || 18);

const RETRY_MAX        = Number(process.env.RETRY_MAX || 6);
const RETRY_BACKOFF_MS = Number(process.env.RETRY_BACKOFF_MS || 900);

const SEEN_FILE = 'data/seen.json';
if (!fssync.existsSync('data')) fssync.mkdirSync('data', { recursive: true });
if (!fssync.existsSync(SEEN_FILE)) fssync.writeFileSync(SEEN_FILE, '[]');

const bot = new Telegraf(BOT_TOKEN);

// ---------- utils ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function callWithRetry(fn, label='tg') {
  let attempt = 0;
  while (true) {
    try { return await fn(); }
    catch (e) {
      const code = e?.response?.error_code || e?.code;
      const retryAfter = e?.response?.parameters?.retry_after;
      if (code === 429 && attempt < RETRY_MAX) {
        const wait = Math.max((retryAfter ? (retryAfter*1000) : 0), RETRY_BACKOFF_MS * (attempt+1));
        console.warn(`[${label}] 429; retry in ${wait}ms (attempt ${attempt+1}/${RETRY_MAX})`);
        await sleep(wait);
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

function buildFooterHTML() {
  // טקסט לחיץ — קישורים מוטמעים, בלי להציג URL
  const parts = [
    `${FOOTER_ONELINE}:`,
    `<a href="${LINK_X}">X</a>`,
    `<a href="${LINK_FB}">פייסבוק</a>`,
    `<a href="${LINK_WA}">ווצאפ</a>`,
    `<a href="${LINK_IG}">אינסטגרם</a>`,
    `<a href="${LINK_TT}">טיקטוק</a>`
  ];
  return parts.join(' | ');
}

async function readSeen() {
  try {
    const raw = await fs.readFile(SEEN_FILE, 'utf8');
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}
async function writeSeen(arr) {
  await fs.writeFile(SEEN_FILE, JSON.stringify(arr.slice(-3000))); // cap
}

function addFooterToText(text) {
  const footer = buildFooterHTML();
  const clean = (text || '').trim();
  return clean ? `${clean}\n\n${footer}` : footer;
}

async function downloadFileById(tg, fileId, outPath) {
  const link = await tg.getFileLink(fileId);
  const res = await axios.get(link.href, { responseType: 'arraybuffer' });
  await fs.writeFile(outPath, res.data);
  return outPath;
}

// ---------- watermark (image via sharp, video via ffmpeg) ----------
async function watermarkImage(inputPath, outputPath) {
  const sharp = (await import('sharp')).default;
  const img = sharp(inputPath);
  const meta = await img.metadata();
  const wmWidth = Math.round((meta.width || 1000) * (WM_WIDTH_PCT/100));
  const wm = await sharp(WM_IMAGE).resize({ width: wmWidth }).png().toBuffer();

  let left = WM_MARGIN, top = WM_MARGIN;
  switch (WM_POS) {
    case 'top-right':     left = (meta.width - wmWidth - WM_MARGIN); top = WM_MARGIN; break;
    case 'bottom-right':  left = (meta.width - wmWidth - WM_MARGIN); top = (meta.height - Math.round(wmWidth*0.6) - WM_MARGIN); break;
    case 'bottom-left':   left = WM_MARGIN; top = (meta.height - Math.round(wmWidth*0.6) - WM_MARGIN); break;
    // default top-left
  }

  await img
    .composite([{ input: wm, left: Math.max(0,left), top: Math.max(0,top) }])
    .jpeg({ quality: 90 })
    .toFile(outputPath);
  return outputPath;
}

async function watermarkVideo(inputPath, outputPath) {
  const ff = spawn('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-i', WM_IMAGE,
    '-filter_complex',
    // scale watermark relative to video width, overlay position by WM_POS
    `[1][0]scale2ref=w=iw*${WM_WIDTH_PCT/100}:h=ow/mdar[wm][vid];` +
    `[vid][wm]overlay=${posExpr(WM_POS, WM_MARGIN)}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'copy',
    outputPath
  ]);

  await new Promise((res, rej) => {
    ff.on('error', rej);
    ff.stderr.on('data', d => process.stdout.write(d.toString()));
    ff.on('close', (code) => code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}`)));
  });
  return outputPath;
}

function posExpr(pos, m) {
  const xRight = `W-w-${m}`;
  const xLeft  = `${m}`;
  const yTop   = `${m}`;
  const yBottom= `H-h-${m}`;
  switch (pos) {
    case 'top-right':    return `${xRight}:${yTop}`;
    case 'bottom-right': return `${xRight}:${yBottom}`;
    case 'bottom-left':  return `${xLeft}:${yBottom}`;
    default:             return `${xLeft}:${yTop}`; // top-left
  }
}

// ---------- handlers ----------
bot.on('channel_post', async (ctx) => {
  const post = ctx.channelPost;
  if (!post?.chat?.id) return;

  // מסננים רק מהמקור שהגדרת
  if (String(post.chat.id) !== String(SOURCE_CHANNEL_ID)) return;

  // אנטי-כפילות
  const seen = await readSeen();
  const key = `${post.chat.id}:${post.message_id}`;
  if (seen.includes(key)) return;
  seen.push(key);
  await writeSeen(seen);

  // טקסט לטיפול (עם פוטר)
  const caption = addFooterToText(post.caption || post.text || '');

  // --- יש מדיה? מטפלים במדבקה ---
  try {
    if (WM_ENABLE && (post.photo?.length || post.video)) {
      // מוחקים את ההודעה המקורית בערוץ היעד אם קיימת עריכה – כאן נפרסם חדש בלבד
      // נוריד, נצרוב WM, ונעלה
      if (post.photo?.length) {
        const fileId = post.photo[post.photo.length - 1].file_id;
        const tmpIn  = `tmp/${key}.jpg`;
        const tmpOut = `tmp/${key}.wm.jpg`;
        await fs.mkdir('tmp', { recursive: true });
        await downloadFileById(ctx.telegram, fileId, tmpIn);
        await watermarkImage(tmpIn, tmpOut);

        await callWithRetry(() => ctx.telegram.sendPhoto(
          TARGET_CHANNEL_ID,
          { source: tmpOut },
          { caption, parse_mode: 'HTML', disable_web_page_preview: DISABLE_WEB_PREVIEW }
        ), 'sendPhoto');

        await fs.rm(tmpIn, { force: true }); await fs.rm(tmpOut, { force: true });
      } else if (post.video) {
        const fileId = post.video.file_id;
        const tmpIn  = `tmp/${key}.mp4`;
        const tmpOut = `tmp/${key}.wm.mp4`;
        await fs.mkdir('tmp', { recursive: true });
        await downloadFileById(ctx.telegram, fileId, tmpIn);
        await watermarkVideo(tmpIn, tmpOut);

        await callWithRetry(() => ctx.telegram.sendVideo(
          TARGET_CHANNEL_ID,
          { source: tmpOut },
          { caption, parse_mode: 'HTML', disable_web_page_preview: DISABLE_WEB_PREVIEW }
        ), 'sendVideo');

        await fs.rm(tmpIn, { force: true }); await fs.rm(tmpOut, { force: true });
      }
      return;
    }

    // --- טקסט בלבד או WM כבוי: נשלח/נערוך בלי צריבה ---
    await callWithRetry(() => ctx.telegram.sendMessage(
      TARGET_CHANNEL_ID,
      caption,
      { parse_mode: 'HTML', disable_web_page_preview: DISABLE_WEB_PREVIEW }
    ), 'sendMessage');

  } catch (e) {
    console.error('handler error:', e?.response || e);
  }
});

// פקודות – רק בפרטי מול ADMIN
bot.command(['ping','status'], async (ctx) => {
  if (String(ctx.chat?.id) !== String(ADMIN_ID)) return;
  await ctx.reply('pong');
});

bot.launch().then(() => console.log('newsSIL boost bot started')).catch(e => console.error('launch failed', e));

// Graceful stop (Railway)
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
