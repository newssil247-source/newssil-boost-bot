import 'dotenv/config';
const { OWNER_TELEGRAM_ID, TARGET_CHANNEL_ID } = process.env;

export async function sendDailyKPI(bot) {
  const kpi = [
    `📊 KPI – ${new Date().toLocaleString('he-IL')}`,
    `• ערוץ: ${TARGET_CHANNEL_ID}`,
    `• פוסטים שנשלחו היום: ~`,
    `• שיתופים לשותפים: ~`,
    `• תגובת קהל (תגובות/סקרים): ~`,
    `• הערות: רענון פוסט ראשון בוצע ✓`
  ].join('\n');
  await bot.sendMessage(OWNER_TELEGRAM_ID, kpi);
}
