
# NewsIL Suite (All-in-One)
This ZIP contains:
- **bot/** → Telegram bot (SEO 10k+, footer A, manager signature, anti-dup, Make routing, media.file_id payload)
- **ffmpeg-worker/** → Express + FFmpeg overlay API for corner + center logos
- **make-blueprints/** → Two Make blueprints (basic + with FFmpeg overlay)
- **assets/** → watermark_corner.png & watermark_center.png (≈70% transparent)

## Deploy order
1) Deploy **ffmpeg-worker** to Railway (builds with ffmpeg preinstalled). Note the URL `/overlay`.
2) Deploy **bot** to Railway; set envs:
   - `BOT_TOKEN`, `TARGET_CHANNEL_ID`, `FOOTER_ONELINE`, (optional) `MAKE_WEBHOOK_URL`.
3) In Make, import blueprint from `make-blueprints/` and set env hints:
   - `TELEGRAM_BOT_TOKEN`
   - (optional) `FFMPEG_OVERLAY_ENDPOINT` (from step 1)
   - `WATERMARK_TOPRIGHT_URL` & `WATERMARK_CENTER_URL` (host your PNGs or use any public URL)
