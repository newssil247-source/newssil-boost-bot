let lastCall = 0;
export async function guardRate(minIntervalMs = 900) {
  const now = Date.now();
  const diff = now - lastCall;
  if (diff < minIntervalMs) {
    await new Promise(r => setTimeout(r, minIntervalMs - diff));
  }
  lastCall = Date.now();
}
