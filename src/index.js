// NewsSIL Boost Bot – v4.2b (Railway Pro)
import 'dotenv/config.js';
import { Telegraf } from 'telegraf';
import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import axios from 'axios';
import { spawn } from 'child_process';
import express from 'express';

// ───────── ENV / Config ─────────
const need = (k) => { if (!process.env[k]) throw new Error(`Missing env ${k}`); return process.env[k]; };

const BOT_TOKEN         = need('BOT_TOKEN');
const SOURCE_CHANNEL_ID = need('SOURCE_CHANNEL_ID');
const TARGET_CHANNEL_ID = need('TARGET_CHANNEL_ID');
const ADMIN_ID          = need('ADMIN_ID');

const IGNORE_BOT_MESSAGES = String(process.env.IGNORE_BOT_MESSAGES || 'true') === 'true';

const FOOTER_ONELINE    = process.env.FOOTER_ONELINE || 'חדשות ישראל IL — הצטרפו/תעקבו כעת';
const FOOTER_VISIBLE_TG = String(process.env.FOOTER_VISIBLE_TG || 'true') === 'true';
const FOOTER_LINKED     = String(process.env.FOOTER_LINKED || 'true') === 'true';
const DISABLE_WEB_PREVIEW = String(process.env.DISABLE_WEB_PREVIEW || 'true') === 'true';

const LINK_X  = need('LINK_X');
const LINK_FB = need('LINK_FB');
const LINK_WA = need('LINK_WA');
const LINK_IG = need('LINK_IG');
const LINK_TT = need('LINK_TT');

const WM_ENABLE    = String(process.env.WM_ENABLE || 'true') === 'true';
const WM_IMAGE     = process.env.WM_IMAGE ? path.resolve(process.env.WM_IMAGE) : path.resolve('assets/il_logo.png');
const WM_POS       = process.env.WM_POS || 'top-right';
const WM_MARGIN    = Number(process.env.WM_MARGIN || 20);
const WM_WIDTH_PCT = Number(process.env.WM_WIDTH_PCT || 18);

const REPLACE_TARGET   = String(process.env.REPLACE_TARGET || 'true') === 'true';
const RETRY_MAX        = Number(process.env.RETRY_MAX || 6);
const RETRY_BACKOFF_MS = Number(process.env.RETRY_BACKOFF_MS || 900);

const SEO_ENABLE = String(process.env.SEO_ENABLE || 'false') === 'true';
const SEO_POST_ENDPOINT = process.env.SEO_POST_ENDPOINT || '';

const GA_ENABLE = String(process.env.GA_ENABLE || 'false') === 'true';
const GA_API_SECRET = process.env.GA_API_SECRET || '';
const GA_MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID || '';

const TG_BOOSTER_ENABLE = String(process.env.TG_BOOSTER_ENABLE || 'true') === 'true';
const TG_KEYWORDS = (process.env.TG_KEYWORDS || '').split(',').map(s=>s.trim()).filter(Boolean);

const META_COMPLIANCE_ENABLE = String(process.env.META_COMPLIANCE_ENABLE || 'false') === 'true';
const META_HARD = (process.env.META_BLOCK_TERMS_HARD || '').split(',').map(s=>s.trim()).filter(Boolean);
const META_SOFT = (process.env.META_BLOCK_TERMS_SOFT || '').split(',').map(s=>s.trim()).filter(Boolean);

const SOCIAL_FOOTER_ENABLE = String(process.env.SOCIAL_FOOTER_ENABLE || 'true') === 'true';
const SOCIAL_FOOTER_SHORT_FOR_X = String(process.env.SOCIAL_FOOTER_SHORT_FOR_X || 'true') === 'true';
const SOCIAL_WM = {
  x:  String(process.env.SOCIAL_WM_X || 'true') === 'true',
  fb: String(process.env.SOCIAL_WM_FB || 'true') === 'true',
  ig: String(process.env.SOCIAL_WM_IG || 'true') === 'true',
  tt: String(process.env.SOCIAL_WM_TT || 'false') === 'true',
};

const LOG_WEBHOOK_URL = process.env.LOG_WEBHOOK_URL || '';
const X_WEBHOOK_URL   = process.env.X_WEBHOOK_URL || '';
const FB_WEBHOOK_URL  = process.env.FB_WEBHOOK_URL || '';
const IG_WEBHOOK_URL  = process.env.IG_WEBHOOK_URL || '';
const TT_WEBHOOK_URL  = process.env.TT_WEBHOOK_URL || '';

const DATA_DIR  = 'data';
const SEEN_FILE = path.join(DATA_DIR,'seen.json');
const MAP_FILE  = path.join(DATA_DIR,'map.json');
if (!fssync.existsSync(DATA_DIR)) fssync.mkdirSync(DATA_DIR, { recursive: true });
if (!fssync.existsSync(SEEN_FILE)) fssync.writeFileSync(SEEN_FILE, '[]');
if (!fssync.existsSync(MAP_FILE))  fssync.writeFileSync(MAP_FILE,  '{}');

// ───────── Core Utils ─────────
const bot = new Telegraf(BOT_TOKEN);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function callWithRetry(fn, label='tg') {
  let attempt = 0;
  for(;;) {
    try { return await fn(); }
    catch (e) {
      const code = e?.response?.error_code || e?.code;
      const retryAfter = e?.response?.parameters?.retry_after;
      if (code === 429 && attempt < RETRY_MAX) {
        const wait = Math.max((retryAfter ? retryAfter*1000 : 0), RETRY_BACKOFF_MS * (attempt+1));
        console.warn(`[${label}] 429; retry in ${wait}ms (attempt ${attempt+1}/${RETRY_MAX})`);
        await sleep(wait); attempt++; continue;
      }
      throw e;
    }
  }
}

async function readSeen(){ try{ return JSON.parse(await fs.readFile(SEEN_FILE,'utf8')||'[]'); }catch{ return []; } }
async function writeSeen(arr){ await fs.writeFile(SEEN_FILE, JSON.stringify(arr.slice(-3000))); }

async function readMap(){ try{ return JSON.parse(await fs.readFile(MAP_FILE,'utf8')||'{}'); }catch{ return {}; } }
async function writeMap(m){ await fs.writeFile(MAP_FILE, JSON.stringify(m)); }

async function deleteOldIfExists(key, tg){
  if (!REPLACE_TARGET) return;
  const map = await readMap();
  const oldTargetId = map[key];
  if (!oldTargetId) return;
  try { await tg.deleteMessage(TARGET_CHANNEL_ID, oldTargetId); } catch {}
}
async function saveMapping(key, newMessageId){
  const map = await readMap(); map[key] = newMessageId; await writeMap(map);
}

function buildFooterHTML(){
  if (!FOOTER_VISIBLE_TG) return '';
  const links = FOOTER_LINKED
    ? `<a href="${LINK_X}">X</a> | <a href="${LINK_FB}">פייסבוק</a> | <a href="${LINK_WA}">וואטסאפ</a> | <a href="${LINK_IG}">אינסטגרם</a> | <a href="${LINK_TT}">טיקטוק</a>`
    : `X | פייסבוק | וואטסאפ | אינסטגרם | טיקטוק`;
  return `${FOOTER_ONELINE}:\n${links}`;
}
function addFooterToText(text){ const clean=(text||'').trim(); const ft=buildFooterHTML(); return ft ? (clean? `${clean}\n\n${ft}`: ft) : clean; }

function boostKeywords(s){
  if (!TG_BOOSTER_ENABLE || !TG_KEYWORDS.length) return s;
  const tags = TG_KEYWORDS.slice(0,8).map(k=>`#${k.replace(/\s+/g,'')}`).join(' ');
  return `${s}\n\n${tags}`;
}

// Meta compliance check (for FB/IG filtering decisions in Make)
function metaCompliant(text=''){
  if (!META_COMPLIANCE_ENABLE) return { ok:true };
  const t = text.toLowerCase();
  if (META_HARD.find(w=>w && t.includes(w))) return { ok:false, level:'hard' };
  if (META_SOFT.find(w=>w && t.includes(w))) return { ok:false, level:'soft' };
  return { ok:true };
}

// GA tracking
async function gaTrack({ name, params = {} }){
  if (!GA_ENABLE || !GA_API_SECRET || !GA_MEASUREMENT_ID) return;
  try{
    await fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ client_id:'newsil-bot', events:[{ name, params }] })
    });
  }catch{}
}

// SEO ingest
async function seoIngest({ text, mediaType, sourceChat, msgId, tags=[] }){
  if (!SEO_ENABLE || !SEO_POST_ENDPOINT) return;
  try{
    await fetch(SEO_POST_ENDPOINT,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body: JSON.stringify({ ts:Date.now(), mediaType, text, tags, sourceChat, msgId,
        links:{ x:LINK_X, fb:LINK_FB, wa:LINK_WA, ig:LINK_IG, tt:LINK_TT } })
    });
  }catch{}
}

// File helpers / watermark
async function downloadFileById(tg, fileId, outPath){
  const link = await tg.getFileLink(fileId);
  const url = typeof link === 'string' ? link : link.href;
  const res = await axios.get(url, { responseType:'arraybuffer' });
  await fs.writeFile(outPath, res.data); return outPath;
}

async function watermarkImage(inputPath, outputPath){
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
    default:              left = WM_MARGIN; top = WM_MARGIN;
  }
  await img.composite([{ input: wm, left: Math.max(0,left), top: Math.max(0,top) }]).jpeg({ quality: 90 }).toFile(outputPath);
  return outputPath;
}

function posExpr(pos, m){
  const xRight = `W-w-${m}`, xLeft = `${m}`, yTop = `${m}`, yBottom = `H-h-${m}`;
  switch (pos){ case 'top-right': return `${xRight}:${yTop}`; case 'bottom-right': return `${xRight}:${yBottom}`; case 'bottom-left': return `${xLeft}:${yBottom}`; default: return `${xLeft}:${yTop}`; }
}
async function watermarkVideo(inputPath, outputPath){
  const ff = spawn('ffmpeg', ['-y','-i',inputPath,'-i',WM_IMAGE,'-filter_complex',
    `[1][0]scale2ref=w=iw*${WM_WIDTH_PCT/100}:h=ow/mdar[wm][vid];[vid][wm]overlay=${posExpr(WM_POS, WM_MARGIN)}`,
    '-c:v','libx264','-preset','veryfast','-crf','23','-c:a','copy', outputPath]);
  await new Promise((res,rej)=>{ ff.on('error',rej); ff.stderr.on('data',d=>process.stdout.write(d.toString())); ff.on('close',c=>c===0?res():rej(new Error('ffmpeg exit '+c))); });
  return outputPath;
}

// Build social footer
function buildSocialFooter({ short=false }) {
  return short
    ? `חדשות ישראל IL – עקבו: X | פייסבוק | וואטסאפ | אינסטגרם | טיקטוק`
    : `חדשות ישראל IL — הצטרפו/תעקבו כעת:\n` +
      `<a href="${LINK_X}">X</a> | <a href="${LINK_FB}">פייסבוק</a> | <a href="${LINK_WA}">וואטסאפ</a> | <a href="${LINK_IG}">אינסטגרם</a> | <a href="${LINK_TT}">טיקטוק</a>`;
}

// Get public file link from Telegram
async function getFileUrl(tg, fileId) {
  const link = await tg.getFileLink(fileId);
  return (typeof link === 'string') ? link : link.href;
}

// Fan-out generic (Make hooks)
async function fanoutToSocials({ text, mediaType, fileId, tg }){
  const media_url = fileId ? await getFileUrl(tg, fileId) : '';
  const socialFooter = SOCIAL_FOOTER_ENABLE ? buildSocialFooter({ short: SOCIAL_FOOTER_SHORT_FOR_X }) : '';
  const wantWM = SOCIAL_WM;

  const payload = JSON.stringify({ text, mediaType, media_url, socialFooter, wantWM });

  const endpoints = [
    { key:'x',  url:X_WEBHOOK_URL },
    { key:'fb', url:FB_WEBHOOK_URL },
    { key:'ig', url:IG_WEBHOOK_URL },
    { key:'tt', url:TT_WEBHOOK_URL },
  ].filter(e=>e.url);

  for (const e of endpoints) {
    try {
      await fetch(e.url, { method:'POST', headers:{'content-type':'application/json'}, body: payload });
      console.log('fanout ok:', e.key);
    } catch(err) {
      console.warn('fanout error:', e.key, err?.message || err);
    }
  }
}

// ───────── Handler ─────────
bot.on('channel_post', async (ctx) => {
  const post = ctx.channelPost;
  if (!post?.chat?.id) return;
  if (IGNORE_BOT_MESSAGES && (post.via_bot || post.from?.is_bot)) return;
  if (String(post.chat.id) !== String(SOURCE_CHANNEL_ID)) return;

  const key = `${post.chat.id}:${post.message_id}`;
  const seen = await readSeen(); if (seen.includes(key)) return;
  seen.push(key); await writeSeen(seen);

  const base = post.caption || post.text || '';
  const boosted = boostKeywords(base);
  const caption = addFooterToText(boosted);

  const mediaType = post.photo ? 'photo' : (post.video ? 'video' : 'text');
  const fileId = post.photo ? post.photo[post.photo.length-1].file_id : (post.video?.file_id || '');

  // SEO + GA
  seoIngest({ text: caption, mediaType, sourceChat: post.chat.id, msgId: post.message_id, tags: TG_KEYWORDS }).catch(()=>{});
  gaTrack({ name:'tg_receive', params:{ media: mediaType }}).catch(()=>{});

  try {
    if (WM_ENABLE && (post.photo?.length || post.video)) {
      await fs.mkdir('tmp', { recursive: true });
      if (post.photo?.length) {
        const inP  = `tmp/${key}.jpg`, outP = `tmp/${key}.wm.jpg`;
        await downloadFileById(ctx.telegram, fileId, inP);
        await watermarkImage(inP, outP);
        await deleteOldIfExists(key, ctx.telegram);
        const sent = await callWithRetry(() => ctx.telegram.sendPhoto(
          TARGET_CHANNEL_ID, { source: outP },
          { caption, parse_mode:'HTML', disable_web_page_preview: DISABLE_WEB_PREVIEW }), 'sendPhoto');
        await saveMapping(key, sent.message_id);
        await fs.rm(inP,{force:true}); await fs.rm(outP,{force:true});
        gaTrack({ name:'tg_forward_ok', params:{ media:'photo' }}).catch(()=>{});
      } else { // video
        const inP  = `tmp/${key}.mp4`, outP = `tmp/${key}.wm.mp4`;
        await downloadFileById(ctx.telegram, fileId, inP);
        await watermarkVideo(inP, outP);
        await deleteOldIfExists(key, ctx.telegram);
        const sent = await callWithRetry(() => ctx.telegram.sendVideo(
          TARGET_CHANNEL_ID, { source: outP },
          { caption, parse_mode:'HTML', disable_web_page_preview: DISABLE_WEB_PREVIEW }), 'sendVideo');
        await saveMapping(key, sent.message_id);
        await fs.rm(inP,{force:true}); await fs.rm(outP,{force:true});
        gaTrack({ name:'tg_forward_ok', params:{ media:'video' }}).catch(()=>{});
      }
    } else {
      await deleteOldIfExists(key, ctx.telegram);
      const sent = await callWithRetry(() => ctx.telegram.sendMessage(
        TARGET_CHANNEL_ID, caption,
        { parse_mode:'HTML', disable_web_page_preview: DISABLE_WEB_PREVIEW }), 'sendMessage');
      await saveMapping(key, sent.message_id);
      gaTrack({ name:'tg_forward_ok', params:{ media:'text' }}).catch(()=>{});
    }

    const meta = metaCompliant(caption);
    if (!meta.ok) console.warn('Meta compliance level:', meta.level);

    await fanoutToSocials({ text: caption, mediaType, fileId, tg: ctx.telegram });

  } catch (e) {
    console.error('handler error:', e?.response || e);
  }
});

// ───────── Admin ─────────
bot.command(['ping','status'], async (ctx) => {
  if (String(ctx.chat?.id) !== String(ADMIN_ID)) return;
  await ctx.reply('pong');
});

// ───────── Launch ─────────
bot.launch().then(()=>console.log('newsSIL boost bot started')).catch(e=>console.error('launch failed', e));
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// ───────── Dashboard ─────────
const DASHBOARD_ENABLE = String(process.env.DASHBOARD_ENABLE || 'true') === 'true';
const DASHBOARD_AUTH_TOKEN = process.env.DASHBOARD_AUTH_TOKEN || '';
if (DASHBOARD_ENABLE) {
  const app = express();
  app.use(express.json());
  app.get('/api/status', (_req,res)=> res.json({ ok:true, ts:Date.now() }));
  app.get('/api/stats', async (req,res)=>{
    const auth = req.headers['x-auth-token'] || req.query.token;
    if (DASHBOARD_AUTH_TOKEN && auth !== DASHBOARD_AUTH_TOKEN) return res.status(401).json({ ok:false });
    try{
      const seen = await readSeen(); const map = await readMap();
      res.json({ ok:true, seen_count:seen.length, map_count:Object.keys(map).length });
    }catch(e){ res.status(500).json({ ok:false, error:String(e) });}
  });
  app.get('/dashboard', (req,res)=>{
    const auth = req.headers['x-auth-token'] || req.query.token;
    if (DASHBOARD_AUTH_TOKEN && auth !== DASHBOARD_AUTH_TOKEN) return res.status(401).send('Unauthorized');
    res.send(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>NewsIL Dashboard</title>
<style>body{font-family:system-ui;margin:24px}.card{padding:16px;border:1px solid #ddd;border-radius:12px;margin-bottom:16px}</style>
</head><body><h2>📊 NewsSIL Bot Dashboard</h2><div class="card"><pre id="stats">Loading…</pre></div>
<script>fetch('/api/stats',{headers:{'x-auth-token':'${DASHBOARD_AUTH_TOKEN}'}}).then(r=>r.json()).then(j=>{document.getElementById('stats').textContent=JSON.stringify(j,null,2);});</script>
</body></html>`);
  });
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, ()=> console.log('Dashboard on :' + PORT));
}
