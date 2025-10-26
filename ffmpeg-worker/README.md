
# NewsIL FFmpeg Overlay Worker
HTTP API to overlay two PNG logos onto an input image/video URL.
- POST /overlay
  body: {
    "input": "<url>",
    "overlay_top_right": "<png url>",
    "overlay_center": "<png url>",
    "center_opacity": 0.3,
    "position_top_right": "10:10"
  }
  returns: { "output_url": "<same file served back as binary or data URL>" }

Note: This demo returns the processed file as a direct response (binary). In Make, you can use the HTTP module to get the response and then upload the content as a file to each network.
