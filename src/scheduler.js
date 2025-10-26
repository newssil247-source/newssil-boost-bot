import 'dotenv/config';

const { TARGET_CHANNEL_ID, FIRST_POST_MESSAGE_ID, ENABLE_PARTNER_FORWARD, PARTNER_CHANNEL_IDS } = process.env;

export async function refreshFirstPost(bot) {
  if (!FIRST_POST_MESSAGE_ID) return 'FIRST_POST_MESSAGE_ID not set';
  try {
    await bot.unpinAllChatMessages(TARGET_CHANNEL_ID).catch(()=>{});
    await bot.pinChatMessage(TARGET_CHANNEL_ID, FIRST_POST_MESSAGE_ID, { disable_notification: true }).catch(()=>{});
    const newMsg = await bot.copyMessage(TARGET_CHANNEL_ID, TARGET_CHANNEL_ID, Number(FIRST_POST_MESSAGE_ID));
    await bot.pinChatMessage(TARGET_CHANNEL_ID, newMsg.message_id, { disable_notification: true });
    return `Pinned ${newMsg.message_id}`;
  } catch (e) {
    return `refresh error: ${e.message}`;
  }
}

export async function forwardToPartners(bot) {
  if (String(ENABLE_PARTNER_FORWARD) !== 'true') return 'partner forward disabled';
  if (!PARTNER_CHANNEL_IDS) return 'no partners';
  const ids = PARTNER_CHANNEL_IDS.split(',').map(s => s.trim()).filter(Boolean);
  try {
    for (const pid of ids) {
      await bot.forwardMessage(pid, TARGET_CHANNEL_ID, Number(process.env.FIRST_POST_MESSAGE_ID)).catch(()=>{});
      await new Promise(r=>setTimeout(r, 1200));
    }
    return `forwarded to ${ids.length} partners`;
  } catch (e) {
    return `partner forward error: ${e.message}`;
  }
}
