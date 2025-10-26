import fs from 'fs';

const keywords = JSON.parse(fs.readFileSync('./data/keywords.json', 'utf8'));

export async function buildPostWithTags(text) {
  const tags = keywords.hashtags.slice(0, 8).join(' ');
  const cleaned = text.replace(/\s+#\S+/g, '');
  return `${cleaned}\n\n${tags}`;
}
