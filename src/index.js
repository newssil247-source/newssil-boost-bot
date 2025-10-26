require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.TARGET_CHANNEL_ID;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log("🚀 Bot started. Make sure the bot is ADMIN in your channel.");

const followLinks = `\nחדשות ישראל IL — הצטרפו/תעקבו: [X](https://did.li/News-x) | [פייסבוק](https://did.li/facebook-IL) | [אינסטגרם](https://www.instagram.com/newss_il?igsh=MXNtNjRjcWluc3pmdw==&utm_source=qr) | [טיקטוק](https://did.li/tiktok-IL)`;

// כל הודעה שנכנסת לערוץ
bot.on('message', async (msg) => {
    if (!msg || msg.chat?.id?.toString() !== CHANNEL_ID.toString()) return;

    let text = msg.caption || msg.text || "";
    const msgId = msg.message_id;

    // אם ההודעה של הבוט עצמו — לא לגעת
    if (msg.from?.is_bot) return;

    // נוסיף את הקישורים אם יש טקסט מעל 10 תווים
    let updated = text;
    if (text.length > 10) {
        updated += followLinks;
    }

    try {
        if (msg.photo) {
            await bot.editMessageCaption(updated, {
                chat_id: CHANNEL_ID,
                message_id: msgId,
                parse_mode: "Markdown"
            });
        } else if (msg.video) {
            await bot.editMessageCaption(updated, {
                chat_id: CHANNEL_ID,
                message_id: msgId,
                parse_mode: "Markdown"
            });
        } else if (msg.text) {
            await bot.editMessageText(updated, {
                chat_id: CHANNEL_ID,
                message_id: msgId,
                parse_mode: "Markdown",
                disable_web_page_preview: true
            });
        }
        console.log("✅ Added follow links to message:", msgId);
    } catch (err) {
        console.error("❌ Edit failed:", err.message);
    }
});

// פקודת בדיקה
bot.onText(/\/status/, (msg) => {
    bot.sendMessage(msg.chat.id, "✅ הבוט רץ ומוסיף קישורים מוטמעים לכל הודעה!", {
        parse_mode: "Markdown"
    });
});

