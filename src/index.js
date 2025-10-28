// NewsSIL In-Channel Processor — v5.4
// Text: edit in-place (footer only). Media: 3–6s -> delete -> repost with WM (photo/video) + footer + hidden SEO (ZWSP).
// No spoiler. Footer skipped if caption contains #hashtag. Avoid loops on bot reposts.

import 'dotenv/config.js';
import { Telegraf } from 'telegraf';
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import axios from 'axios';
import { spawn } from 'child_process';

// ---------- ENV helpers ----------
const need = (k) => {
  const v = process.env[k];
  if (!v || String(v).trim() === '') throw new Error(`Missing env ${k}`);
  return v;
};

// ---------- Required ----------
const BOT_TOKEN         = need('BOT_TOKEN');
const SOURCE_CHANNEL_ID = need('SOURCE_CHANNEL_ID'); // single channel we operate in
const TARGET_CHANNEL_ID = need('TARGET_CHANNEL_ID'); // must equal SOURCE
const ADMIN_ID          = need('ADMIN_ID');

// ---------- Behavior flags ----------
const DISABLE_WEB_PAGE_PREVIEW = String(process.env.DISABLE_WEB_PAGE_PREVIEW || 'true') === 'true';
const DISABLE_NOTIFICATIONS    = String(process.env.DISABLE_NOTIFICATIONS    || 'true') === 'true';
const IGNORE_BOT_MESSAGES      = String(process.env.IGNORE_BOT_MESSAGES      || 'true') === 'true'; // ignore bot-authored channel_post to avoid loops

// Footer & Links
const FOOTER_VISIBLE_TG      = String(process.env.FOOTER_VISIBLE_TG || 'true') === 'true';
const FOOTER_LINKED          = String(process.env.FOOTER_LINKED     || 'true') === 'true';
const SKIP_FOOTER_IF_HASHTAG = String(process.env.SKIP_FOOTER_IF_HASHTAG || 'true') === 'true';
const LINK_X  = need('LINK_X');
const LINK_FB = need('LINK_FB');
const LINK_WA = need('LINK_WA');
const LINK_IG = need('LINK_IG');
const LINK_TT = need('LINK_TT');

// Watermark (images/videos only)
const WM_ENABLE    = String(process.env.WM_ENABLE || 'true') === 'true';
const WM_IMAGE     = process.env.WM_IMAGE || 'assets/il_logo.png';
const WM_POS       = process.env.WM_POS || 'top-right'; // top-right|bottom-right|bottom-left|top-left
const WM_MARGIN    = Number(process.env.WM_MARGIN || 20);
const WM_WIDTH_PCT = Number(process.env.WM_WIDTH_PCT || 18);

// Hidden SEO in Telegram (no spoiler)
// SEO_TG_MODE=zwsp | none
const SEO_TG_ENABLE    = String(process.env.SEO_TG_ENABLE || 'true') === 'true';
const SEO_TG_MODE      = (process.env.SEO_TG_MODE || 'zwsp').toLowerCase();
const SEO_TEXT         = process.env.SEO_TEXT || '';
const SEO_TG_MAX_CHARS = Number(process.env.SEO_TG_MAX_CHARS || 800);

// ---------- Files ----------
if (!fssync.existsSync('data')) fssync.mkdirSync('data', { recursive: true });

// ---------- Bot ----------
const bot = new Telegraf(BOT_TOKEN);

// ---------- Utils ----------
const SEND_OPTS = {
  parse_mode: 'HTML',
  disable_web_page_preview: DISABLE_WEB_PAGE_PREVIEW,
  disable_notification: DISABLE_NOTIFICATIONS
};

function hasHashtag(s='') { return /(^|\s)#\w+/u.test(String(s)); }
function mediaDelayMs() { return 3000 + Math.floor(Math.random() * 3000); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function callWithRetry(fn, label='tg', max=5, backoff=900) {
  let attempt = 0;
  for (;;) {
    try { return await fn(); }
    catch (e) {
      const code = e?.response?.error_code || e?.code;
      const retryAfter = e?.response?.parameters?.retry_after;
      if (code === 429 && attempt < max) {
        const wait = Math.max((retryAfter ? retryAfter*1000 : 0), backoff*(attempt+1));
        console.warn(`[${label}] 429; retry in ${wait}ms (attempt ${attempt+1}/${max})`);
        await sleep(wait); attempt++; continue;
      }
      console.error(`[${label}]`, e?.response || e);
      throw e;
    }
  }
}

function clampText(s=''){ return String(s).slice(0,4096); }
function clampCaption(s=''){ return String(s).slice(0,1024); }

function buildFooterHTML() {
  if (!FOOTER_VISIBLE_TG) return '';
  const linked = FOOTER_LINKED;
  const a = (name, href) => linked ? `<a href="${href}">${name}</a>` : name;
  return `חדשות ישראל IL - תעקבו אחרינו
${a('X', LINK_X)} | ${a('Facebook', LINK_FB)} | ${a('WhatsApp', LINK_WA)} | ${a('Instagram', LINK_IG)} | ${a('TikTok', LINK_TT)}`;
}

function buildHiddenSeoZwsp(raw='', max=800) {
  if (!SEO_TG_ENABLE || SEO_TG_MODE !== 'zwsp') return '';
  let txt = String(raw || '').trim();
  if (!txt) return '';
  if (txt.length > max) txt = txt.slice(0, max);
  const zwsp = '\u200B';
  const packed = txt.split('').join(zwsp);
  return `\n${packed}`; // invisible to the eye
}

function makeTextWithFooter(base, addFooter) {
  const footer = addFooter ? `\n\n${buildFooterHTML()}` : '';
  return (String(base||'').trim() + footer).trim();
}

function makeCaptionForMedia(base, addFooter) {
  const footer = addFooter ? `\n\n${buildFooterHTML()}` : '';
  const hiddenSeo = buildHiddenSeoZwsp(SEO_TEXT, SEO_TG_MAX_CHARS); // invisible SEO
  return (String(base||'').trim() + footer + hiddenSeo).trim();
}

async function downloadFileById(tg, fileId, outPath) {
  const link = await tg.getFileLink(fileId);
  const url = typeof link === 'string' ? link : link.href;
  const res = await axios.get(url, { responseType: 'arraybuffer' });
  await fs.writeFile(outPath, res.data);
  return outPath;
}

// ---------- Watermark ----------
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
    default:              left = WM_MARGIN; top = WM_MARGIN; // top-left
  }

  await img.composite([{ input: wm, left: Math.max(0,left), top: Math.max(0,top) }])
          .jpeg({ quality: 90 })
          .toFile(outputPath);
  return outputPath;
}

function posExpr(pos, m) {
  const xR=`W-w-${m}`, xL=`${m}`, yT=`${m}`, yB=`H-h-${m}`;
  switch (pos) {
    case 'top-right':    return `${xR}:${yT}`;
    case 'bottom-right': return `${xR}:${yB}`;
    case 'bottom-left':  return `${xL}:${yB}`;
    default:             return `${xL}:${yT}`;
  }
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

// ---------- Handler ----------
bot.on('channel_post', async (ctx) => {
  const post = ctx.channelPost;
  if (!post?.chat?.id) return;
  if (String(post.chat.id) !== String(SOURCE_CHANNEL_ID)) return;

  // ignore bot-authored messages (like our own reposts) to avoid loops
  if (IGNORE_BOT_MESSAGES && (post.from?.is_bot || post.via_bot)) return;

  const baseText = (post.caption || post.text || '').trim();
  const wantFooter = FOOTER_VISIBLE_TG && !(SKIP_FOOTER_IF_HASHTAG && hasHashtag(baseText));

  const isPhoto = !!post.photo?.length;
  const isVideo = !!post.video;
  const isAnim  = !!post.animation;
  const isDoc   = !!post.document;
  const isMedia = isPhoto || isVideo || isAnim || isDoc;

  try {
    // -------- TEXT ONLY: edit in-place (footer only) --------
    if (!isMedia) {
      const finalText = clampText(makeTextWithFooter(baseText, wantFooter));
      await callWithRetry(() =>
        ctx.telegram.editMessageText(
          post.chat.id,
          post.message_id,
          undefined,
          finalText,
          { ...SEND_OPTS }
        ),
        'editMessageText(in-place)'
      );
      return;
    }

    // -------- MEDIA: wait 3–6s, delete original, repost with WM+footer+hidden SEO (ZWSP) --------
    await sleep(mediaDelayMs());
    await fs.mkdir('tmp', { recursive: true });

    let inP, outP, sent;

    if (isPhoto) {
      const fileId = post.photo[post.photo.length - 1].file_id;
      inP  = `tmp/${post.chat.id}_${post.message_id}.jpg`;
      outP = `tmp/${post.chat.id}_${post.message_id}.wm.jpg`;
      await downloadFileById(ctx.telegram, fileId, inP);
      if (WM_ENABLE) await watermarkImage(inP, outP);

      // delete original silently
      try { await ctx.telegram.deleteMessage(post.chat.id, post.message_id); } catch {}

      const caption = clampCaption(makeCaptionForMedia(baseText, wantFooter));
      sent = await callWithRetry(() =>
        ctx.telegram.sendPhoto(
          TARGET_CHANNEL_ID,
          { source: WM_ENABLE ? outP : inP },
          { ...SEND_OPTS, caption }
        ),
        'sendPhoto(repost)'
      );

    } else if (isVideo) {
      const fileId = post.video.file_id;
      inP  = `tmp/${post.chat.id}_${post.message_id}.mp4`;
      outP = `tmp/${post.chat.id}_${post.message_id}.wm.mp4`;
      await downloadFileById(ctx.telegram, fileId, inP);
      if (WM_ENABLE) await watermarkVideo(inP, outP);

      try { await ctx.telegram.deleteMessage(post.chat.id, post.message_id); } catch {}

      const caption = clampCaption(makeCaptionForMedia(baseText, wantFooter));
      sent = await callWithRetry(() =>
        ctx.telegram.sendVideo(
          TARGET_CHANNEL_ID,
          { source: WM_ENABLE ? outP : inP },
          { ...SEND_OPTS, caption }
        ),
        'sendVideo(repost)'
      );

    } else {
      // GIF / Document: no WM, but delete + repost with footer + hidden SEO
      const fileId = isAnim ? post.animation.file_id : post.document.file_id;
      const ext    = isAnim ? 'gif' : (post.document.file_name?.split('.').pop() || 'bin');
      inP  = `tmp/${post.chat.id}_${post.message_id}.${ext}`;
      await downloadFileById(ctx.telegram, fileId, inP);

      try { await ctx.telegram.deleteMessage(post.chat.id, post.message_id); } catch {}

      const caption = clampCaption(makeCaptionForMedia(baseText, wantFooter));
      const method  = isAnim ? 'sendAnimation' : 'sendDocument';
      sent = await callWithRetry(() =>
        ctx.telegram[method](
          TARGET_CHANNEL_ID,
          { source: inP },
          { ...SEND_OPTS, caption }
        ),
        `${method}(repost)`
      );
    }

    // cleanup
    try { if (inP) await fs.rm(inP, { force:true }); if (outP) await fs.rm(outP, { force:true }); } catch {}

  } catch (e) {
    console.error('handler error:', e?.response || e);
  }
});

// ---------- Admin ----------
bot.command(['ping','status'], async (ctx) => {
  if (String(ctx.chat?.id) !== String(ADMIN_ID)) return;
  await ctx.reply('pong');
});
bot.command('whoami', async (ctx) => {
  if (String(ctx.chat?.id) !== String(ADMIN_ID)) return;
  await ctx.reply(`chatId=${ctx.chat?.id}, type=${ctx.chat?.type}`);
});

// ---------- Launch ----------
(async () => {
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true })
      .catch(e => console.warn('deleteWebhook warn:', e?.message || e));
    await bot.launch();
    console.log('newsSIL in-channel bot started');
  } catch (e) {
    console.error('launch failed', e);
  }
})();

// ---------- Graceful stop ----------
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
