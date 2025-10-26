// src/index.cjs
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';

const {
  BOT_TOKEN,
  TARGET_CHANNEL_ID,
  FOOTER_ONELINE,
  MAKE_WEBHOOK_URL,
  WATERMARK_STICKER_FILE_ID,

  KEYWORDS_FILE = './data/keywords.txt',
  KEYWORDS_PER_POST = '450',
  KEYWORD_ROTATE_EDIT_AFTER_MIN = '0',
  ADD_SPOILER_KEYWORDS = 'true',
} = process.env;

if (!BOT_TOKEN || !TARGET_CHANNEL_ID || !FOOTER_ONELINE) {
  console.error('Missing env: BOT_TOKEN / TARGET_CHANNEL_ID / FOOTER_ONELINE');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function isOnlyHashtags(text=''){ const t=(text||'').trim(); if(!t) return false; const noSpaces=t.replace(/\s+/g,''); return /^#[^\s#]+(?:#[^\s#]+)*$/u.test(noSpaces); }
function appendFooter(text, footer, authorSignature){ if(isOnlyHashtags(text)) return text; const base=(text||'').trim(); const withSig=authorSignature?`${base}\n— ${authorSignature}`:base; return withSig?`${withSig}\n\n${footer}`:footer; }
const BAD_WORDS=['דם','חיסול','קטל','טבח','גופות','ערופים','הוצאה להורג','טרור','אונס','חתכו','שיסוף','פיצוץ גופות','פצוע קשה','מזעזע','גרפיות','גולגולת'];
const SAFE_HASHTAG_OVERRIDE='#SAFEPOST';
const cleanForOtherPlatforms=(text='')=>{ const t=(text||'').toLowerCase(); if(t.includes(SAFE_HASHTAG_OVERRIDE.toLowerCase())) return true; return !BAD_WORDS.some(w=>t.includes(w.toLowerCase())); };

let KW=[]; let kwOffset=0;
(function loadKeywords(){ try{ const p=path.resolve(KEYWORDS_FILE); if(fs.existsSync(p)){ KW=fs.readFileSync(p,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean); console.log(`SEO: loaded ${KW.length} keywords`);} else { console.log('SEO: no keywords file'); } }catch(e){ console.log('SEO load error:', e.message); } })();
function takeKeywords(n){ if(!KW.length||!n) return []; const start=kwOffset%KW.length; const out=[]; for(let i=0;i<n;i++) out.push(KW[(start+i)%KW.length]); kwOffset=(start+n)%KW.length; return out; }
function buildHidden(words){ if(!words.length) return ''; const block=words.join(' · '); return (ADD_SPOILER_KEYWORDS==='true')?`\n\n||${block}||`:`\n\n\u2063`+words.join('\u2063 \u2063'); }

const SEEN_FILE='./data/seen.json'; let seen=new Set(); try{ if(fs.existsSync(SEEN_FILE)) seen=new Set(JSON.parse(fs.readFileSync(SEEN_FILE,'utf8')));}catch{}; const saveSeen=()=>{ try{ fs.writeFileSync(SEEN_FILE, JSON.stringify([...seen].slice(-3000))); }catch{} };

['pinned_message','new_chat_members','left_chat_member','poll','chat_join_request'].forEach(ev=>bot.on(ev,()=>{}));

bot.on('channel_post', async (msg)=>{
  try{
    const chatId=msg.chat?.id?.toString();
    if(!chatId || chatId!==TARGET_CHANNEL_ID) return;
    const key=String(msg.message_id);
    if(seen.has(key)) return;
    seen.add(key); saveSeen();

    const authorSignature=msg.author_signature||'';
    const hasPhoto=Array.isArray(msg.photo)&&msg.photo.length>0;
    const hasVideo=!!msg.video;
    const hasAnimation=!!msg.animation;
    const hasDocument=!!msg.document;
    const hasMedia=hasPhoto||hasVideo||hasAnimation||hasDocument;
    const originalText=msg.text||msg.caption||'';

    let finalText=appendFooter(originalText, FOOTER_ONELINE, authorSignature);
    const n=Math.max(0, Math.min(parseInt(KEYWORDS_PER_POST,10)||0, 700));
    const pack=takeKeywords(n);
    const hidden=buildHidden(pack);
    if(finalText.length + hidden.length <= 4096) finalText += hidden;

    // Publish on Telegram
    if(hasMedia){
      await bot.copyMessage(chatId, chatId, msg.message_id, { caption: finalText, parse_mode:'Markdown' });
      if(WATERMARK_STICKER_FILE_ID){ try{ await bot.sendSticker(chatId, WATERMARK_STICKER_FILE_ID, { reply_to_message_id: msg.message_id }); }catch{} }
    } else {
      await bot.sendMessage(chatId, finalText, { parse_mode:'Markdown' });
    }

    // Prepare media for Make (file_id)
    let media = null;
    if (hasPhoto && Array.isArray(msg.photo)) {
      const p = msg.photo[msg.photo.length - 1];
      media = { type: 'photo', file_id: p.file_id };
    } else if (hasVideo && msg.video?.file_id) {
      media = { type: 'video', file_id: msg.video.file_id };
    } else if (hasAnimation && msg.animation?.file_id) {
      media = { type: 'animation', file_id: msg.animation.file_id };
    } else if (hasDocument && msg.document?.file_id) {
      media = { type: 'document', file_id: msg.document.file_id };
    }

    const allowOn={
      x: true,
      facebook: true,
      facebookMedia: hasMedia && cleanForOtherPlatforms(originalText),
      instagram: hasMedia && cleanForOtherPlatforms(originalText),
      tiktok: hasVideo && cleanForOtherPlatforms(originalText)
    };

    if(process.env.MAKE_WEBHOOK_URL){
      try{
        await fetch(process.env.MAKE_WEBHOOK_URL, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            source:'telegram', chatId, messageId: msg.message_id,
            text: finalText, originalText, hasMedia,
            mediaTypes:{ photo:hasPhoto, video:hasVideo, animation:hasAnimation, document:hasDocument },
            media, allowOn, authorSignature
          })
        });
      }catch(e){ console.error('Make webhook failed:', e.message); }
    }
  }catch(e){ console.error('handler error:', e.message); }
});

console.log('✅ Bot online. Target:', TARGET_CHANNEL_ID);
