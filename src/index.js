// NewsSIL In-Place Editor — v7.0
// • Text: editMessageText (footer only)
// • Media (photo/video/gif/document): watermark (photo/video) -> editMessageMedia on SAME message
// • No deletes, no delay, no spoiler/SEO, no re-post
// • Footer with links; skip nothing unless תבקשו
// • Requires: Node 18+, telegraf@4, sharp, ffmpeg in runtime

import 'dotenv/config.js';
import { Telegraf } from 'telegraf';
import fs from 'fs/promises';
import fssync from 'fs';
import axios from 'axios';
import { spawn } from 'child_process';

// ---------- Required ENV ----------
const need = (k) => {
  const v = process.env[k];
  if (!v || String(v).trim() === '') throw new Error(`Missing env ${k}`);
  return v;
};

const BOT_TOKEN         = need('BOT_TOKEN');
const SOURCE_CHANNEL_ID = need('SOURCE_CHANNEL_ID');  // פועל רק בערוץ הזה
const ADMIN_ID          = process.env.ADMIN_ID || ''; // אופציונלי לפקודות

// ---------- Options ----------
const DISABLE_WEB_PREVIEW = String(process.env.DISABLE_WEB_PREVIEW || 'true') === 'true';
const DISABLE_NOTIFICATIONS = String(process.env.DISABLE_NOTIFICATIONS || 'true') === 'true';
const IGNORE_BOT_MESSAGES = String(process.env.IGNORE_BOT_MESSAGES || 'true') === 'true';

// Footer & Links
const FOOTER_VISIBLE_TG = String(process.env.FOOTER_VISIBLE_TG || 'true') === 'true';
const FOOTER_LINKED     = String(process.env.FOOTER_LINKED     || 'true') === 'true';
const LINK_X  = need('LINK_X');
const LINK_FB = need('LINK_FB');
const LINK_WA = need('LINK_WA');
const LINK_IG = need('LINK_IG');
const LINK_TT = need('LINK_TT');

// Watermark (images/videos only)
const WM_ENABLE    = String(process.env.WM_ENABLE || 'true') === 'true';
const WM_IMAGE     = process.env.WM_IMAGE || 'assets/il_logo.png';
const WM_POS       = (process.env.WM_POS || 'top-right').toLowerCase(); // top-right|bottom-right|bottom-left|top-left
const WM_MARGIN    = Number(process.env.WM_MARGIN || 20);
const WM_WIDTH_PCT = Number(process.env.WM_WIDTH_PCT || 18);

// ---------- Files / state ----------
const DATA_DIR = 'data';
const TMP_DIR  = 'tmp';
const SEEN_FILE = `${DATA_DIR}/seen.json`;
if (!fssync.existsSync(DATA_DIR)) fssync.mkdirSync(DATA_DIR, { recursive: true });
if (!fssync.existsSync(SEEN_FILE)) fssync.writeFileSync(SEEN_FILE, '[]');

// ---------- Bot ----------
const bot = new Telegraf(BOT_TOKEN);

// ---------- Utils ----------
const SEND_OPTS = {
  parse_mode: 'HTML',
  disable_web_page_preview: DISABLE_WEB_PREVIEW,
  disable_notification: DISABLE_NOTIFICATIONS,
};

function hasHashtag(s='') { return /(^|\s)#\w+/u.test(String(s)); }
function clampText(s=''){ return String(s).slice(0,4096); }
function clampCaption(s=''){ return String(s).slice(0,1024); }

async function callWithRetry(fn, label='tg', max=4, backoff=700) {
  let attempt = 0;
  for (;;) {
    try { return await fn(); }
    catch (e) {
      const code = e?.response?.error_code || e?.code;
      const retryAfter = e?.response?.parameters?.retry_after;
      if (code === 429 && attempt < max) {
        const wait = Math.max((retryAfter ? retryAfter*1000 : 0), backoff*(attempt+1));
        console.warn(`[${label}] 429; retry in ${wait}ms (attempt ${attempt+1}/${max})`);
        await new Promise(r => setTimeout(r, wait));
        attempt++; continue;
      }
      console.error(`[${label}]`, e?.response || e);
      throw e;
    }
  }
}

async function readSeen() {
  try {
    const raw = await fs.readFile(SEEN_FILE, 'utf8');
    const j = JSON.parse(raw);
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}
async function writeSeen(arr) {
  await fs.writeFile(SEEN_FILE, JSON.stringify(arr.slice(-4000)));
}

function buildFooterHTML() {
  if (!FOOTER_VISIBLE_TG) return '';
  const header = `חדשות ישראל IL — עקבו אחרינו:`;
  const links = FOOTER_LINKED
    ? `<a href="${LINK_X}">X</a> | <a href="${LINK_FB}">Facebook</a> | <a href="${LINK_WA}">WhatsApp</a> | <a href="${LINK_IG}">Instagram</a> | <a href="${LINK_TT}">TikTok</a>`
    : `X | Facebook | WhatsApp | Instagram | TikTok`;
  return `${header}\n${links}`;
}

function composeTextWithFooter(base) {
  const footer = buildFooterHTML();
  const clean = String(base || '').trim();
  return clampText( clean ? `${clean}\n\n${footer}` : footer );
}

function composeCaptionWithFooter(base) {
  const footer = buildFooterHTML();
  const clean = String(base || '').trim();
  return clampCaption( clean ? `${clean}\n\n${footer}` : footer );
}

async function downloadFileById(tg, fileId, outPath) {
  const link = await tg.getFileLink(fileId);
  const url = typeof link === 'string' ? link : link.href;
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  await fs.writeFile(outPath, res.data);
  return outPath;
}

// ---------- Watermark ----------
function posExpr(pos, m) {
  const xR=`W-w-${m}`, xL=`${m}`, yT=`${m}`, yB=`H-h-${m}`;
  switch (pos) {
    case 'top-right':    return `${xR}:${yT}`;
    case 'bottom-right': return `${xR}:${yB}`;
    case 'bottom-left':  return `${xL}:${yB}`;
    default:             return `${xL}:${yT}`; // top-left
  }
}

async function watermarkImage(inputPath, outputPath) {
  const sharp = (await import('sharp')).default;
  const img = sharp(inputPath);
  const meta = await img.metadata();
  const wmWidth = Math.round((meta.width || 1000) * (WM_WIDTH_PCT / 100));
  const wm = await sharp(WM_IMAGE).resize({ width: wmWidth }).png().toBuffer();

  let left = WM_MARGIN, top = WM_MARGIN;
  switch (WM_POS) {
    case 'top-right':     left = (meta.width - wmWidth - WM_MARGIN); top = WM_MARGIN; break;
    case 'bottom-right':  left = (meta.width - wmWidth - WM_MARGIN); top = (meta.height - Math.round(wmWidth*0.6) - WM_MARGIN); break;
    case 'bottom-left':   left = WM_MARGIN; top = (meta.height - Math.round(wmWidth*0.6) - WM_MARGIN); break;
    default:              left = WM_MARGIN; top = WM_MARGIN;
  }

  await img.composite([{ input: wm, left: Math.max(0,left), top: Math.max(0,top) }])
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
    `[1][0]scale2ref=w=iw*${WM_WIDTH_PCT/100}:h=ow/mdar[wm][vid];[vid][wm]overlay=${posExpr(WM_POS, WM_MARGIN)}`,
    '-c:v','libx264','-preset','veryfast','-crf','23',
    '-c:a','copy',
    outputPath
  ]);
  await new Promise((res, rej) => {
    ff.on('error', rej);
    ff.stderr.on('data', d => process.stdout.write(d.toString()));
    ff.on('close', (code) => code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}`)));
  });
  return outputPath;
}

// ---------- Handlers ----------
// נענה רק ל־channel_post (לא ל־edited_channel_post) כדי לא ליפול ללולאה אחרי עריכה
bot.on('channel_post', async (ctx) => {
  const post = ctx.channelPost;
  if (!post?.chat?.id) return;
  if (String(post.chat.id) !== String(SOURCE_CHANNEL_ID)) return;
  if (IGNORE_BOT_MESSAGES && (post.from?.is_bot || post.via_bot)) return;

  // אנטי-כפילות ראשונית
  const k = `${post.chat.id}:${post.message_id}`;
  const seen = await readSeen();
  if (seen.includes(k)) return;
  seen.push(k);
  await writeSeen(seen);

  try {
    // TEXT ONLY — edit in-place (footer only)
    if (!post.photo && !post.video && !post.animation && !post.document) {
      const baseText = (post.text || '').trim();
      const finalText = composeTextWithFooter(baseText);
      await callWithRetry(() =>
        ctx.telegram.editMessageText(
          post.chat.id, post.message_id, undefined,
          finalText, { ...SEND_OPTS }
        ), 'editMessageText'
      );
      return;
    }

    // MEDIA — in-place edit (no delete, no delay)
    await fs.mkdir(TMP_DIR, { recursive: true });

    const baseCaption = (post.caption || '').trim();
    const finalCaption = composeCaptionWithFooter(baseCaption);

    if (post.photo?.length) {
      const fileId = post.photo[post.photo.length - 1].file_id;
      const inP  = `${TMP_DIR}/${post.chat.id}_${post.message_id}.jpg`;
      const outP = `${TMP_DIR}/${post.chat.id}_${post.message_id}.wm.jpg`;
      await downloadFileById(ctx.telegram, fileId, inP);
      const mediaPath = WM_ENABLE ? await watermarkImage(inP, outP) : inP;

      await callWithRetry(() =>
        ctx.telegram.editMessageMedia(
          post.chat.id, post.message_id, undefined,
          { type: 'photo', media: { source: mediaPath }, caption: finalCaption, parse_mode: 'HTML' },
          { disable_web_page_preview: DISABLE_WEB_PREVIEW, disable_notification: DISABLE_NOTIFICATIONS }
        ), 'editMessageMedia(photo)'
      );

      try { await fs.rm(inP, {force:true}); await fs.rm(outP, {force:true}); } catch {}

      return;
    }

    if (post.video) {
      const fileId = post.video.file_id;
      const inP  = `${TMP_DIR}/${post.chat.id}_${post.message_id}.mp4`;
      const outP = `${TMP_DIR}/${post.chat.id}_${post.message_id}.wm.mp4`;
      await downloadFileById(ctx.telegram, fileId, inP);
      const mediaPath = WM_ENABLE ? await watermarkVideo(inP, outP) : inP;

      await callWithRetry(() =>
        ctx.telegram.editMessageMedia(
          post.chat.id, post.message_id, undefined,
          { type: 'video', media: { source: mediaPath }, caption: finalCaption, parse_mode: 'HTML' },
          { disable_web_page_preview: DISABLE_WEB_PREVIEW, disable_notification: DISABLE_NOTIFICATIONS }
        ), 'editMessageMedia(video)'
      );

      try { await fs.rm(inP, {force:true}); await fs.rm(outP, {force:true}); } catch {}

      return;
    }

    if (post.animation) {
      // GIF — אין WM; עריכת המדיה/כיתוב בפנים
      const fileId = post.animation.file_id;
      const inP  = `${TMP_DIR}/${post.chat.id}_${post.message_id}.gif`;
      await downloadFileById(ctx.telegram, fileId, inP);

      await callWithRetry(() =>
        ctx.telegram.editMessageMedia(
          post.chat.id, post.message_id, undefined,
          { type: 'animation', media: { source: inP }, caption: finalCaption, parse_mode: 'HTML' },
          { disable_web_page_preview: DISABLE_WEB_PREVIEW, disable_notification: DISABLE_NOTIFICATIONS }
        ), 'editMessageMedia(animation)'
      );

      try { await fs.rm(inP, {force:true}); } catch {}
      return;
    }

    if (post.document) {
      // Document — אין WM; עריכת המדיה/כיתוב בפנים
      const fileId = post.document.file_id;
      const ext = post.document.file_name?.split('.').pop() || 'bin';
      const inP  = `${TMP_DIR}/${post.chat.id}_${post.message_id}.${ext}`;
      await downloadFileById(ctx.telegram, fileId, inP);

      await callWithRetry(() =>
        ctx.telegram.editMessageMedia(
          post.chat.id, post.message_id, undefined,
          { type: 'document', media: { source: inP }, caption: finalCaption, parse_mode: 'HTML' },
          { disable_web_page_preview: DISABLE_WEB_PREVIEW, disable_notification: DISABLE_NOTIFICATIONS }
        ), 'editMessageMedia(document)'
      );

      try { await fs.rm(inP, {force:true}); } catch {}
      return;
    }

  } catch (e) {
    console.error('handler error:', e?.response || e);
  }
});

// ---------- Admin ----------
bot.command(['ping','status'], async (ctx) => {
  if (ADMIN_ID && String(ctx.chat?.id) === String(ADMIN_ID)) {
    await ctx.reply('pong');
  }
});

// ---------- Launch ----------
(async () => {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true })
      .catch(() => {});
    await bot.launch();
    console.log('NewsSIL in-place editor started');
  } catch (e) {
    console.error('launch failed', e);
  }
})();

// ---------- Graceful stop ----------
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
