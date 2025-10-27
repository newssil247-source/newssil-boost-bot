import { Telegraf } from 'telegraf';
import fs from 'fs';

const bot = new Telegraf(process.env.BOT_TOKEN);

const CHANNEL_ID = process.env.MAIN_TELEGRAM_CHANNEL_ID;
const SEEN_FILE = './data/seen.json';

// ensure file exists
if (!fs.existsSync(SEEN_FILE)) {
  fs.writeFileSync(SEEN_FILE, '[]');
}

let seen = JSON.parse(fs.readFileSync(SEEN_FILE));

// Auto footer (without displayed links)
const FOOTER = "\n\nחדשות ישראל IL — הצטרפו/תעקבו כעת: X | פייסבוק | וואטסאפ | אינסטגרם | טיקטוק";

// Handler when new message forwarded from source channel
bot.on('channel_post', async (ctx) => {
  try {
    const msg = ctx.channelPost;
    const id = `${msg.chat.id}:${msg.message_id}`;

    if (seen.includes(id)) return;

    seen.push(id);
    fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2));

    // If contains media
    if (msg.photo) {
      await ctx.telegram.sendPhoto(
        CHANNEL_ID,
        msg.photo[msg.photo.length - 1].file_id,
        { caption: (msg.caption || "") + FOOTER }
      );
    } else if (msg.video) {
      await ctx.telegram.sendVideo(
        CHANNEL_ID,
        msg.video.file_id,
        { caption: (msg.caption || "") + FOOTER }
      );
    } else {
      // Text only
      await ctx.telegram.sendMessage(CHANNEL_ID, msg.text + FOOTER);
    }

    console.log("✔ New post replicated with embedded footer");

  } catch (err) {
    console.error("❌ Error:", err.message);
  }
});

// Start
bot.launch();
console.log("✅ NewsIL Boost Bot Active");
