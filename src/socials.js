import axios from 'axios';

/**
 * Cross-post handlers using simple Webhook pattern.
 * Set WEBHOOK URLs in .env to integrate via Make/Zapier/IFTTT/Buffer/etc.
 * Each webhook receives JSON: { text, source: 'telegram', channel_id, message_id }
 */

const {
  SOCIAL_TWITTER_WEBHOOK,
  SOCIAL_INSTAGRAM_WEBHOOK,
  SOCIAL_FACEBOOK_WEBHOOK,
  SOCIAL_TIKTOK_WEBHOOK
} = process.env;

async function postTo(webhook, payload) {
  if (!webhook) return 'skipped';
  try {
    await axios.post(webhook, payload, { timeout: 15000 });
    return 'ok';
  } catch (e) {
    return `err:${e.message}`;
  }
}

export async function crossPostAll({ text, channelId, messageId }) {
  const payload = { text, source: 'telegram', channel_id: channelId, message_id: messageId };

  const results = {
    twitter: await postTo(SOCIAL_TWITTER_WEBHOOK, payload),
    instagram: await postTo(SOCIAL_INSTAGRAM_WEBHOOK, payload),
    facebook: await postTo(SOCIAL_FACEBOOK_WEBHOOK, payload),
    tiktok: await postTo(SOCIAL_TIKTOK_WEBHOOK, payload),
  };

  return results;
}
