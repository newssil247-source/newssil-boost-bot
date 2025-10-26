import 'dotenv/config';
export function isOwner(msg) {
  return String(msg.from?.id) === String(process.env.OWNER_TELEGRAM_ID);
}
