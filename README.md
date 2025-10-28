# NewsSIL Boost Bot (Railway, v4.2b)

Mirrors posts from a Telegram source channel to a target channel, adds clickable footer, applies watermark (image/video), supports delete+repost strategy, optional SEO ingest + GA tracking, optional fan-out to Make (X/FB/IG/TT), and a minimal dashboard.

## Quick Start
1) Copy `.env.example` → fill values (or paste into Railway Raw Editor).
2) Ensure the bot is **Admin** on both SOURCE & TARGET (with Delete Messages on target).
3) Deploy on Railway. Logs should show: `newsSIL boost bot started`.

## Endpoints
- `/dashboard?token=...` — mini dashboard
- `/api/status` — health
- `/api/stats` — seen/map counts
