import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { CronJob } from 'cron';
import { buildPostWithTags } from './seo.js';
import { refreshFirstPost, forwardToPartners } from './scheduler.js';
import { scanCompetitorsAndAdapt } from './competitors.js';
import { sendDailyKPI } from './kpi.js';
import { guardRate } from './guard.js';
import { isOwner } from './utils.js';
import { crossPostAll } from './socials.js';

const {
  BOT_TOKEN,
  TARGET_CHANNEL_ID,
  OWNER_TELEGRAM_ID,
  REFRESH_EVERY_MINUTES = 180,
  COMPETITOR_SCAN_EVERY_MINUTES = 360,
  KPI_REPORT_HOUR = 23,
  CRON_TZ = 'Asia/Jerusalem'
} = process.env;

if (!BOT_TOKEN || !TARGET_CHANNEL_ID) {
  console.error('Missing BOT_TOKEN or TARGET_CHANNEL_ID in .env');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Admin commands
bot.onText(/^\/start$/, async (msg) => {
  if (!isOwner(msg)) return;
  await bot.sendMessage(msg.chat.id, '✅ בוט פעיל. /status לבדיקה, /boost לריענון, /kpi לדוח.');
});

bot.onText(/^\/status$/, async (msg) => {
  if (!isOwner(msg)) return;
  await bot.sendMessage(msg.chat.id, `🟢 רץ.\nערוץ יעד: ${TARGET_CHANNEL_ID}\nריענון כל ${REFRESH_EVERY_MINUTES} דק'\nסריקת מתחרים כל ${COMPETITOR_SCAN_EVERY_MINUTES} דק'`);
});

bot.onText(/^\/boost$/, async (msg) => {
  if (!isOwner(msg)) return;
  await guardRate();
  const res = await refreshFirstPost(bot);
  await bot.sendMessage(msg.chat.id, `⚡ Boost Done: ${res}`);
});

bot.onText(/^\/kpi$/, async (msg) => {
  if (!isOwner(msg)) return;
  await sendDailyKPI(bot);
  await bot.sendMessage(msg.chat.id, '📈 KPI נשלח.');
});

// Any private message -> tagged and posted to channel
bot.on('message', async (msg) => {
  if (String(msg.chat.id) === String(TARGET_CHANNEL_ID)) return;
  if (!msg.text) return;

  try {
    await guardRate();
    const tagged = await buildPostWithTags(msg.text);
    const sent = await bot.sendMessage(TARGET_CHANNEL_ID, tagged, { disable_web_page_preview: true });
    // Cross-post to socials
    await crossPostAll({ text: tagged, channelId: TARGET_CHANNEL_ID, messageId: sent.message_id });
  } catch (e) {
    console.error('message handler error', e.message);
  }
});

// Cron jobs
new CronJob(`*/${REFRESH_EVERY_MINUTES} * * * *`, async () => {
  try {
    await guardRate();
    await refreshFirstPost(bot);
    await forwardToPartners(bot);
  } catch (e) { console.error('refresh cron:', e.message); }
}, null, true, CRON_TZ);

new CronJob(`*/${COMPETITOR_SCAN_EVERY_MINUTES} * * * *`, async () => {
  try {
    await guardRate();
    await scanCompetitorsAndAdapt(bot);
  } catch (e) { console.error('competitor cron:', e.message); }
}, null, true, CRON_TZ);

new CronJob(`0 ${KPI_REPORT_HOUR} * * *`, async () => {
  try {
    await sendDailyKPI(bot);
  } catch (e) { console.error('kpi cron:', e.message); }
}, null, true, CRON_TZ);

console.log('🚀 Bot started. Make sure the bot is ADMIN in your channel.');
