// ========= NewsSIL Boost Bot =========
// Version: v6.0 – WM: top-right – Hidden SEO – Footer A

import 'dotenv/config.js';
import { Telegraf } from 'telegraf';
import fs from 'fs/promises';
import fssync from 'fs';
import axios from 'axios';
import { spawn } from 'child_process';
import path from 'path';

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.SOURCE_CHANNEL_ID; // מקור = יעד בטלגרם
const DISABLE_WEB_PREVIEW = String(process.env.DISABLE_WEB_PREVIEW || 'true') === 'true';

// --- Footer Config ---
const FOOTER_VISIBLE = String(process.env.FOOTER_VISIBLE_TG || 'true') === 'true';
const FOOTER_LINKED = String(process.env.FOOTER_LINKED || 'true') === 'true';

const LINK_X = process.env.LINK_X;
const LINK_FB = process.env.LINK_FB;
const LINK_WA = process.env.LINK_WA;
const LINK_IG = process.env.LINK_IG;
const LINK_TT = process.env.LINK_TT;

// --- WM Config ---
const WM_ENABLE = String(process.env.WM_ENABLE || 'true') === 'true';
const WM_IMAGE = process.env.WM_IMAGE || 'assets/il_logo.png';
const WM_POS = process.env.WM_POS || 'top-right';
const WM_MARGIN = Number(process.env.WM_MARGIN || 20);
const WM_WIDTH_PCT = Number(process.env.WM_WIDTH_PCT || 18);

// === Seen Anti-Duplicate Storage ===
const SEEN_FILE = 'data/seen.json';
if (!fssync.existsSync('data')) fssync.mkdirSync('data', { recursive: true });
if (!fssync.existsSync(SEEN_FILE)) fssync.writeFileSync(SEEN_FILE, '[]');

// Bot Init
const bot = new Telegraf(BOT_TOKEN);

// Random delay 3–6 sec
const randDelay = () => 3000 + Math.random() * 3000;

// Footer A
function buildFooter() {
  if (!FOOTER_VISIBLE) return '';
  const header = `חדשות ישראל IL — עקבו אחרינו:`;
  const links = FOOTER_LINKED
    ? `<a href="${LINK_X}">X</a> | <a href="${LINK_FB}">Facebook</a> | <a href="${LINK_WA}">WhatsApp</a> | <a href="${LINK_IG}">Instagram</a> | <a href="${LINK_TT}">TikTok</a>`
    : `X | Facebook | WhatsApp | Instagram | TikTok`;
  return `${header}\n${links}`;
}

// Hidden SEO for ranking
function buildSEO() {
  return `<span class="tg-spoiler">חדשות ישראל iL NEWS IL NewsIL חדשות ישראל מבזק</span>`;
}

// Watermark Video
async function watermarkVideo(input, output) {
  return new Promise((res, rej) => {
    const ff = spawn('ffmpeg', [
      '-y',
      '-i', input,
      '-i', WM_IMAGE,
      '-filter_complex',
      `[1][0]scale2ref=w=iw*${WM_WIDTH_PCT/100}:h=ow/mdar[wm][vid];[vid][wm]overlay=W-w-${WM_MARGIN}:${WM_MARGIN}`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'copy',
      output
    ]);

    ff.on('error', rej);
    ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)));
  });
}

// Watermark Image
async function watermarkImage(input, output) {
  const sharp = (await import('sharp')).default;
  const img = sharp(input);
  const meta = await img.metadata();
  const wmW = Math.round(meta.width * WM_WIDTH_PCT / 100);

  const wm = await sharp(WM_IMAGE).resize({ width: wmW }).png().toBuffer();
  await img.composite([{
    input: wm,
    left: meta.width - wmW - WM_MARGIN,
    top: WM_MARGIN
  }]).jpeg({ quality: 90 }).toFile(output);

  return output;
}

// Download
async function downloadFile(tg, fileId, dest) {
  const link = await tg.getFileLink(fileId);
  const r = await axios.get(link.href, { responseType: 'arraybuffer' });
  await fs.writeFile(dest, r.data);
  return dest;
}

// Anti duplicate
async function seenPush(key) {
  const arr = JSON.parse(await fs.readFile(SEEN_FILE, 'utf8'));
  if (arr.includes(key)) return false;
  arr.push(key);
  await fs.writeFile(SEEN_FILE, JSON.stringify(arr.slice(-4000)));
  return true;
}

bot.on('channel_post', async ctx => {
  const msg = ctx.channelPost;
  if (!msg?.chat?.id) return;
  if (String(msg.chat.id) !== String(CHANNEL_ID)) return;

  const key = `${msg.chat.id}:${msg.message_id}`;
  if (!await seenPush(key)) return; // ignore duplicates

  const baseText = msg.caption || msg.text || '';
  const footer = buildFooter();
  const seo = buildSEO();
  const caption = `${baseText}\n\n${footer}\n${seo}`.trim();

  const tg = ctx.telegram;

  // TEXT ONLY → edit in place
  if (!msg.photo && !msg.video) {
    return await tg.editMessageText(msg.chat.id, msg.message_id, null, caption, {
      parse_mode: 'HTML',
      disable_web_page_preview: DISABLE_WEB_PREVIEW
    });
  }

  // MEDIA → delay 3–6 sec, delete+new inside
  await new Promise(r => setTimeout(r, randDelay()));

  try {
    await tg.deleteMessage(msg.chat.id, msg.message_id);
  } catch {}

  await fs.mkdir('tmp', { recursive: true });
  const tmpIn = `tmp/${key}.bin`;
  const ext = msg.video ? '.mp4' : '.jpg';
  const tmpOut = `tmp/${key}.wm${ext}`;

  await downloadFile(tg, msg.video ? msg.video.file_id : msg.photo.pop().file_id, tmpIn);

  if (WM_ENABLE) {
    msg.video
      ? await watermarkVideo(tmpIn, tmpOut)
      : await watermarkImage(tmpIn, tmpOut);
  }

  if (msg.video) {
    await tg.sendVideo(CHANNEL_ID, { source: tmpOut }, {
      caption,
      parse_mode: 'HTML',
      disable_web_page_preview: DISABLE_WEB_PREVIEW
    });
  } else {
    await tg.sendPhoto(CHANNEL_ID, { source: tmpOut }, {
      caption,
      parse_mode: 'HTML',
      disable_web_page_preview: DISABLE_WEB_PREVIEW
    });
  }

  await fs.rm(tmpIn, { force: true });
  await fs.rm(tmpOut, { force: true });
});

// Admin test
bot.command('ping', ctx => ctx.reply('pong'));

bot.launch();
