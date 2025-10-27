// src/index.js — Mode C (Smart) — Newssil v4.3-C
import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import { Telegraf } from 'telegraf';
import fs from 'fs-extra';
import fetch from 'node-fetch';
import path from 'path';
import { attachWeb } from './web.js';
import { addWatermark } from './media.js';

// ====== Required ENV ======
const BOT_TOKEN = process.env.BOT_TOKEN;
const SOURCE_CHANNEL_ID = process.env.SOURCE_CHANNEL_ID; // e.g., -1002111890470
const ADMIN_ID = process.env.ADMIN_ID || '';

if (!BOT_TOKEN || !SOURCE_CHANNEL_ID) {
  console.error('Missing env (BOT_TOKEN or SOURCE_CHANNEL_ID)');
  process.exit(1);
}

// ====== Config (optional) ======
let FOOTER = process.env.FOOTER_STYLE_A || 'חדשות ישראל IL — הצטרפו/תעקבו: X | פייסבוק | אינסטגרם | טיקטוק | וואצאפ';
const SEO_ENABLED = (process.env.SEO_ENABLED || 'true') === 'true';
const KEYWORDS_PER_POST = Number(process.env.KEYWORDS_PER_POST || 20);
const KEYWORDS_DIR = process.env.KEYWORDS_DIR || 'data/keywords_chunks';
const FILTER_LEVEL = (process.env.CONTENT_FILTER_LEVEL || 'medium').toLowerCase();

const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL || '';
const BASEURL = process.env.WEB_BASEURL || '';

const WM_ENABLED = (process.env.WATERMARK_ENABLED || 'true') === 'true';
const WM_CORNER = process.env.WM_CORNER || 'assets/watermark_corner.png';
const WM_CENTER = process.env.WM_CENTER || 'assets/watermark_center.png';
const WM_POS = process.env.WM_POS || 'top-right';

const RETRY_MAX = Number(process.env.RETRY_MAX || 3);
const RETRY_BACKOFF_MS = Number(process.env.RETRY_BACKOFF_MS || 800);

// ====== Helpers ======
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
    const pick = files.includes('trends_live.txt') ? 'trends_live.txt' : files[Math.floor(Math.random()*files.length)];
    const arr = (await fs.readFile(path.join(KEYWORDS_DIR, pick),'utf8')).split(/\r?\n/).filter(Boolean);
    const out = [];
    for (let i=0;i<n && arr.length;i++) out.push(arr[Math.floor(Math.random()*arr.length)]);
    return out;
  } catch { return []; }
}
const spoiler = s => (s ? `||${s}||` : '');
function allowedIGTT(text='') {
  if (FILTER_LEVEL === 'low') return true;
  const blocked = (fs.readFileSync('filters/blocked_words.txt','utf8')||'').split(/\r?\n/).filter(Boolean);
  const t = (text||'').toLowerCase();
  return !blocked.some(w => w && t.includes(w));
}
async function withRetry(name, fn) {
  let lastErr;
  for (let i=0;i<RETRY_MAX;i++) {
    try { return await fn(i); }
    catch(e){ lastErr = e; console.error(`[retry:${name}] ${i+1}/${RETRY_MAX}:`, e.message); await new Promise(r=>setTimeout(r, RETRY_BACKOFF_MS*(i+1))); }
  }
  throw lastErr;
}
async function maybeWebhook(payload){
  if (!MAKE_WEBHOOK_URL) return;
  try {
    await withRetry('make.webhook', ()=> fetch(MAKE_WEBHOOK_URL,{
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
    }));
  } catch(e){ console.error('MAKE error', e.message); }
}
function buildCaption(base, kws){
  const parts=[];
  if (base) parts.push(base);
  if (SEO_ENABLED) parts.push(spoiler((kws||[]).join(' · ')));
  if (!onlyHashtags(base)) parts.push(FOOTER);
  return parts.join('\n\n');
}

// ====== Auto-Clean (fix) ======
function attachAutoClean(){
  if ((process.env.AUTO_CLEAN_ENABLED||'true')!=='true') return;
  const maxDays = Number(process.env.AUTO_CLEAN_MAX_DAYS||7);
  const ms = maxDays*24*60*60*1000;
  const roots = ['web/static','web/processed'];
  setInterval(async ()=>{
    try{
      const now = Date.now();
      for(const root of roots){
        if(!await fs.pathExists(root)) continue;
        const files = await fs.readdir(root);
        for(const f of files){
          const p = path.join(root,f);
          const st = await fs.stat(p);
          if(now - st.mtimeMs > ms) await fs.remove(p);
        }
      }
    }catch(e){ console.error('autoclean', e.message); }
  }, 6*60*60*1000);
}

// ====== Seen (anti-duplicate) ======
const seenPath = 'data/seen.json';
await fs.ensureFile(seenPath);
const seen = new Set(JSON.parse(await fs.readFile(seenPath, 'utf8') || '[]'));
async function persistSeen(){ await fs.writeFile(seenPath, JSON.stringify([...seen], null, 2)); }

// ====== Web + Dashboard ======
const app = express();
app.use(bodyParser.json());
attachWeb(app);
const PORT = process.env.PORT || 8080;
app.listen(PORT, ()=> console.log('Web + API up on', PORT));
attachAutoClean();

// ====== Telegram Bot ======
const bot = new Telegraf(BOT_TOKEN);
const isAdmin = (ctx) => ADMIN_ID && String(ctx.from?.id)===String(ADMIN_ID);

bot.command('status', async (ctx)=>{ if(!isAdmin(ctx)) return;
  await ctx.reply(`OK
SEO:${SEO_ENABLED}  KW:${KEYWORDS_PER_POST}  WM:${WM_ENABLED}  Filter:${FILTER_LEVEL}
Footer: ${FOOTER}`);
});
bot.hears(/^\/setfooter\s+(.+)/i, async (ctx)=>{ if(!isAdmin(ctx)) return;
  const m = ctx.message.text.match(/^\/setfooter\s+(.+)/i);
  if(m){ FOOTER=m[1].trim(); await ctx.reply('Footer updated'); }
});
bot.hears(/^\/seo\s+(on|off)/i, async (ctx)=>{ if(!isAdmin(ctx)) return;
  const on = /on/i.test(ctx.message.text); await ctx.reply(`SEO ${on?'ON':'OFF'}`);
});

async function tgDownload(file_id){
  const meta = await (await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${file_id}`)).json();
  if(!meta.ok) throw new Error('getFile failed');
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${meta.result.file_path}`;
  const arr = await (await fetch(url)).arrayBuffer();
  return { buf: Buffer.from(arr), file_path: meta.result.file_path };
}

// ====== Core handler (Smart Mode) ======
bot.on('channel_post', async (ctx)=>{
  const post = ctx.update.channel_post;
  // ignore old messages (> 30 min)
if (Date.now()/1000 - post.date > 1800) return;
  try{
    if (!post) return;
    if (isServiceMessage(post)) return;

    const key = `${post.chat.id}:${post.message_id}`;
    if (seen.has(key)) return; // anti-duplicate
    seen.add(key); await persistSeen();

    const baseText = post.text || post.caption || '';
    const kws = await loadKeywords(KEYWORDS_PER_POST);
    const caption = buildCaption(baseText, kws);

    // Mirror (for SEO & dashboard)
    if (app.locals.webAppend) {
      await app.locals.webAppend({
        id:String(post.message_id),
        title:(baseText||'').slice(0,80),
        summary:(baseText||'').slice(0,400),
        sourceUrl:`https://t.me/${String(SOURCE_CHANNEL_ID).replace('@','')}/${post.message_id}`,
        ts:Date.now()
      });
    }

    const payload = {
      platform:'telegram',
      postId:key,
      text: baseText,
      footerApplied: !onlyHashtags(baseText),
      seoHidden: SEO_ENABLED,
      allowIGTikTok: allowedIGTT(baseText),
      assets:{}
    };

    // === TEXT: edit in place ===
    if (post.text) {
      await withRetry('tg.editText', ()=> ctx.telegram.editMessageText(
        post.chat.id, post.message_id, undefined, caption, { disable_web_page_preview:false }
      ));
      if (app.locals.logEvent) await app.locals.logEvent('post_text', { id:key });
      await maybeWebhook(payload);
      return;
    }

    // === MEDIA: download → watermark → delete → repost ===
    const m = post.photo ? {type:'photo', id:post.photo[post.photo.length-1].file_id} :
              post.video ? {type:'video', id:post.video.file_id} :
              post.animation ? {type:'animation', id:post.animation.file_id} :
              post.document ? {type:'document', id:post.document.file_id} : null;

    if (!m) return;

    const { buf, file_path } = await tgDownload(m.id);
    const ext = (file_path.split('.').pop()||'mp4').toLowerCase();
    const rawName = `${post.message_id}.${ext}`;
    const rawPath = path.join('web','processed', rawName);
    await fs.ensureDir(path.dirname(rawPath));
    await fs.writeFile(rawPath, buf);

    let outPath = rawPath;
    if (WM_ENABLED) {
      outPath = await addWatermark(rawPath, WM_CORNER, WM_CENTER, WM_POS); // Watermark B (corner + center)
    }

    // save static URL for Make
    const fileBytes = await fs.readFile(outPath);
    const staticName = path.basename(outPath);
    await fs.ensureDir('web/static');
    await fs.writeFile(path.join('web','static', staticName), fileBytes);
    const relUrl = `/static/${staticName}`;
    payload.assets.processed_url = `${BASEURL}${relUrl}`;

    // delete original quietly + repost
    try { await withRetry('tg.delete', ()=> ctx.telegram.deleteMessage(post.chat.id, post.message_id)); } catch {}
    if (m.type==='photo') {
      await withRetry('tg.sendPhoto', ()=> ctx.telegram.sendPhoto(post.chat.id, { source: fs.createReadStream(outPath) }, { caption }));
    } else if (m.type==='video') {
      await withRetry('tg.sendVideo', ()=> ctx.telegram.sendVideo(post.chat.id, { source: fs.createReadStream(outPath) }, { caption }));
    } else if (m.type==='animation') {
      await withRetry('tg.sendAnimation', ()=> ctx.telegram.sendAnimation(post.chat.id, { source: fs.createReadStream(outPath) }, { caption }));
    } else if (m.type==='document') {
      await withRetry('tg.sendDocument', ()=> ctx.telegram.sendDocument(post.chat.id, { source: fs.createReadStream(outPath) }, { caption }));
    }

    if (app.locals.logEvent) await app.locals.logEvent('post_media', { id:key, type:m.type });
    await maybeWebhook(payload);                       // cross-post to Make
    if (app.locals.logEvent) await app.locals.logEvent('crosspost', { id:key });

  }catch(e){
    console.error('handler error', e);
    try { if(ADMIN_ID) await ctx.telegram.sendMessage(ADMIN_ID, '❌ '+e.message); } catch {}
    if (app.locals.logEvent) await app.locals.logEvent('error', { message: e.message });
  }
});

bot.launch()
  .then(()=> console.log('✅ v4.3-C started'))
  .catch(e=>{ console.error(e); process.exit(1); });

process.once('SIGINT', ()=> bot.stop('SIGINT'));
process.once('SIGTERM', ()=> bot.stop('SIGTERM'));
