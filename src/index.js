// Newssil Boost Bot — v4.4 Repost + Make
// - Upload-then-Delete for all post types (no edits)
// - Corner-only watermark (handled in media.js)
// - Silent SEO on Telegram, keywords sent to Make
// - Robust seen.json + retry + backoff
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import fs from 'fs-extra';
import path from 'path';
import fetch from 'node-fetch';
import { Telegraf } from 'telegraf';
import { addWatermark } from './media.js';   // חייב לתמוך: addWatermark(input, cornerPng, centerPng, pos)
import { attachWeb } from './web.js';        // אופציונלי: דשבורד/סטטי

// ---------- ENV ----------
const BOT_TOKEN          = process.env.BOT_TOKEN;
const SOURCE_CHANNEL_ID  = process.env.SOURCE_CHANNEL_ID;      // e.g. -1002111890470
const ADMIN_ID           = process.env.ADMIN_ID || '';

let   FOOTER             = process.env.FOOTER_STYLE_A ||
  'חדשות ישראל IL — הצטרפו/תעקבו: https://x.com/newssil | https://www.facebook.com/share/173b9ycBuP/?mibextid=wwXIfr | https://www.instagram.com/newss_il?igsh=MXNtNjRjcWluc3pmdw%3D%3D&utm_source=qr | https://www.tiktok.com/@newss_il?_t=ZS-90sXDtL1OdD&_r=1 | https://whatsapp.com/channel/0029VaKyMK8ICVfrbqvQ6n0D';

const SEO_ENABLED        = (process.env.SEO_ENABLED || 'true') === 'true';
const SEO_TG_VISIBLE     = (process.env.SEO_TG_VISIBLE || 'false') === 'true'; // כברירת מחדל לא מציגים
const KEYWORDS_PER_POST  = Number(process.env.KEYWORDS_PER_POST || 20);
const KEYWORDS_DIR       = process.env.KEYWORDS_DIR || 'data/keywords_chunks';

const WATERMARK_ENABLED  = (process.env.WATERMARK_ENABLED || 'true') === 'true';
const WM_CORNER          = process.env.WM_CORNER || 'assets/watermark_corner.png';
const WM_CENTER          = process.env.WM_CENTER || '';  // ריק => אין מרכז
const WM_POS             = process.env.WM_POS || 'top-right';

const MAKE_WEBHOOK_URL   = process.env.MAKE_WEBHOOK_URL || ''; // כתובת webhook של Make
const WEB_BASEURL        = process.env.WEB_BASEURL || '';       // דומיין לקבצים סטטיים (אם יש)

const RETRY_MAX          = Number(process.env.RETRY_MAX || 10);
const RETRY_BACKOFF_MS   = Number(process.env.RETRY_BACKOFF_MS || 900);
const IGNORE_OLDER_SEC   = Number(process.env.IGNORE_OLDER_SEC || 1800); // 30 דקות

if (!BOT_TOKEN || !SOURCE_CHANNEL_ID) {
  console.error('❌ Missing BOT_TOKEN or SOURCE_CHANNEL_ID'); process.exit(1);
}

// ---------- Helpers ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function withRetry(name, fn) {
  let last;
  for (let i=0;i<RETRY_MAX;i++) {
    try { return await fn(i); }
    catch (e) {
      last = e;
      const ra = e?.parameters?.retry_after ? (e.parameters.retry_after*1000) : RETRY_BACKOFF_MS*(i+1);
      console.error(`[retry:${name}] ${i+1}/${RETRY_MAX} -> ${e.message} (sleep ${ra}ms)`);
      await sleep(ra);
    }
  }
  throw last;
}
function isServiceMessage(p) {
  return Boolean(
    p.pinned_message || p.new_chat_members || p.left_chat_member || p.new_chat_title ||
    p.new_chat_photo || p.delete_chat_photo || p.group_chat_created || p.supergroup_chat_created ||
    p.channel_chat_created || p.message_auto_delete_timer_changed || p.migrate_to_chat_id ||
    p.migrate_from_chat_id || p.successful_payment || p.connected_website || p.write_access_allowed ||
    p.forum_topic_created || p.forum_topic_edited || p.forum_topic_closed || p.forum_topic_reopened ||
    p.video_chat_scheduled || p.video_chat_started || p.video_chat_ended ||
    p.video_chat_participants_invited || p.giveaway_created || p.giveaway || p.giveaway_winners ||
    p.giveaway_completed
  );
}
function onlyHashtags(text='') {
  if (!text.trim()) return false;
  const noSpaces = text.replace(/\s+/g,'').trim();
  const hashCount = (noSpaces.match(/#/g)||[]).length;
  const letters = noSpaces.replace(/[#_\d]/g,'').length;
  return hashCount>0 && letters===0;
}
async function loadKeywords(n) {
  try {
    const files = (await fs.readdir(KEYWORDS_DIR)).filter(f => f.endsWith('.txt'));
    if (!files.length) return [];
    const pick = files.includes('trends_live.txt')
      ? 'trends_live.txt'
      : files[Math.floor(Math.random()*files.length)];
    const lines = (await fs.readFile(path.join(KEYWORDS_DIR,pick),'utf8'))
                  .split(/\r?\n/).filter(Boolean);
    const out=[]; for(let i=0;i<n && lines.length;i++) out.push(lines[Math.floor(Math.random()*lines.length)]);
    return out;
  } catch { return []; }
}
const spoiler = s => (s ? `||${s}||` : '');
function buildCaption(base, kws, { includeKeywords=false } = {}) {
  const parts = [];
  if (base) parts.push(base);
  if (SEO_ENABLED && includeKeywords && kws?.length) parts.push(spoiler(kws.join(' · '))); // לא מוצג כברירת מחדל
  if (!onlyHashtags(base)) parts.push(FOOTER);
  return parts.join('\n\n');
}

// ---------- Seen store (robust) ----------
const seenPath = 'data/seen.json';
await fs.ensureDir('data');
let seenSet = new Set();
try {
  const raw = await fs.readFile(seenPath,'utf8');
  const arr = JSON.parse(raw || '[]');  // במקרה של [] פגום
  if (Array.isArray(arr)) seenSet = new Set(arr);
  else throw new Error('seen not array');
} catch (e) {
  console.warn('seen.json corrupted -> reset []', e.message);
  await fs.writeFile(seenPath,'[]');
  seenSet = new Set();
}
async function persistSeen() {
  try { await fs.writeFile(seenPath, JSON.stringify([...seenSet], null, 2)); }
  catch (e) { console.error('persistSeen failed', e.message); }
}

// ---------- Web / dashboard (optional) ----------
const app = express();
app.use(bodyParser.json());
attachWeb?.(app);
const PORT = process.env.PORT || 8080;
app.listen(PORT, ()=> console.log('HTTP up on', PORT));

// ---------- Telegram ----------
const bot = new Telegraf(BOT_TOKEN);
const isAdmin = (ctx) => ADMIN_ID && String(ctx.from?.id)===String(ADMIN_ID);

bot.command('status', async (ctx)=>{ if(!isAdmin(ctx)) return;
  await ctx.reply(`✅ Running
SEO:${SEO_ENABLED} (tgVisible=${SEO_TG_VISIBLE})  KW:${KEYWORDS_PER_POST}
WM:${WATERMARK_ENABLED} pos:${WM_POS}
Footer: ${FOOTER.slice(0,110)}...
Make: ${MAKE_WEBHOOK_URL ? 'ON' : 'OFF'}`);
});
bot.hears(/^\/setfooter\s+(.+)/i, async (ctx)=>{ if(!isAdmin(ctx)) return;
  const m = ctx.message.text.match(/^\/setfooter\s+(.+)/i);
  if (m) { FOOTER = m[1].trim(); await ctx.reply('Footer updated'); }
});
bot.hears(/^\/seo\s+(on|off)/i, async (ctx)=>{ if(!isAdmin(ctx)) return;
  const on = /on/i.test(ctx.message.text); await ctx.reply(`SEO ${on?'ON':'OFF'}`); });

// file download
async function tgDownload(file_id) {
  const g = await (await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${file_id}`)).json();
  if (!g.ok) throw new Error('getFile failed');
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${g.result.file_path}`;
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  return { buf, file_path: g.result.file_path };
}

// notify Make
async function notifyMake(payload){
  if (!MAKE_WEBHOOK_URL) return;
  try {
    await withRetry('make.webhook', ()=> fetch(MAKE_WEBHOOK_URL, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    }));
  } catch(e){ console.error('MAKE error:', e.message); }
}

// ---------- Core handler ----------
bot.on('channel_post', async (ctx)=>{
  const post = ctx.update.channel_post;
  try {
    if (!post || isServiceMessage(post)) return;

    // הימנעות מסריקות עבר
    if ((Date.now()/1000) - post.date > IGNORE_OLDER_SEC) return;

    const key = `${post.chat.id}:${post.message_id}`;
    if (seenSet.has(key)) return;
    seenSet.add(key); await persistSeen();

    const baseText = post.text || post.caption || '';
    const kws = await loadKeywords(KEYWORDS_PER_POST);
    const caption = buildCaption(baseText, kws, { includeKeywords: SEO_TG_VISIBLE });

    // הכנה ל-Make
    const payload = {
      platform: 'telegram',
      postId: key,
      chatId: post.chat.id,
      messageId: post.message_id,
      text: baseText,
      footerApplied: !onlyHashtags(baseText),
      keywords: kws,                 // Make ישתמש ל-ALT/Metadata
      assets: {}
    };

    // ----- TEXT: שלח חדש → מחק ישן -----
    if (post.text) {
      const sent = await withRetry('tg.sendMessage', () =>
        ctx.telegram.sendMessage(post.chat.id, caption, { disable_web_page_preview: false })
      );
      if (sent?.message_id) {
        try { await withRetry('tg.delete', () => ctx.telegram.deleteMessage(post.chat.id, post.message_id)); } catch {}
      }
      await notifyMake(payload);
      return;
    }

    // ----- MEDIA: הורדה → ווטרמרק פינה → שליחה → ואז מחיקה -----
    const media =
      post.photo     ? { type:'photo',     id: post.photo[post.photo.length-1].file_id } :
      post.video     ? { type:'video',     id: post.video.file_id } :
      post.animation ? { type:'animation', id: post.animation.file_id } :
      post.document  ? { type:'document',  id: post.document.file_id } : null;

    if (!media) return;

    const { buf, file_path } = await tgDownload(media.id);
    const ext = (file_path.split('.').pop() || 'mp4').toLowerCase();
    const rawName = `${post.message_id}.${ext}`;
    const rawPath = path.join('web','processed', rawName);
    await fs.ensureDir(path.dirname(rawPath));
    await fs.writeFile(rawPath, buf);

    let outPath = rawPath;
    if (WATERMARK_ENABLED) {
      outPath = await addWatermark(rawPath, WM_CORNER, WM_CENTER, WM_POS); // אם WM_CENTER ריק—רק פינה
    }

    // קובץ סטטי ל-Make (אם WEB_BASEURL קיים)
    await fs.ensureDir('web/static');
    const staticName = path.basename(outPath);
    const staticPath = path.join('web','static', staticName);
    await fs.copy(outPath, staticPath);
    if (WEB_BASEURL) payload.assets.processed_url = `${WEB_BASEURL}/static/${staticName}`;

    // שליחה לפי סוג
    let sent;
    if (media.type==='photo') {
      sent = await withRetry('tg.sendPhoto', () =>
        ctx.telegram.sendPhoto(post.chat.id, { source: fs.createReadStream(outPath) }, { caption })
      );
    } else if (media.type==='video') {
      sent = await withRetry('tg.sendVideo', () =>
        ctx.telegram.sendVideo(post.chat.id, { source: fs.createReadStream(outPath) }, { caption })
      );
    } else if (media.type==='animation') {
      sent = await withRetry('tg.sendAnimation', () =>
        ctx.telegram.sendAnimation(post.chat.id, { source: fs.createReadStream(outPath) }, { caption })
      );
    } else {
      sent = await withRetry('tg.sendDocument', () =>
        ctx.telegram.sendDocument(post.chat.id, { source: fs.createReadStream(outPath) }, { caption })
      );
    }

    if (sent?.message_id) {
      try { await withRetry('tg.delete', () => ctx.telegram.deleteMessage(post.chat.id, post.message_id)); } catch {}
    }

    await notifyMake(payload);
  } catch (e) {
    console.error('handler error:', e);
    try { if (ADMIN_ID) await ctx.telegram.sendMessage(ADMIN_ID, '❌ ' + e.message); } catch {}
  }
});

bot.launch()
  .then(()=> console.log('✅ Bot up (v4.4)'))
  .catch(e => { console.error(e); process.exit(1); });

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
