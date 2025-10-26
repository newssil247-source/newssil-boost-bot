import express from 'express';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
const app = express();
app.use(express.json({limit:'20mb'}));

function tmpfile(ext){ return path.join(os.tmpdir(), `${randomUUID()}.${ext}`); }
async function downloadTo(url, dest){
  const res = await fetch(url);
  if(!res.ok) throw new Error(`download failed ${res.status}`);
  const fileStream = fs.createWriteStream(dest);
  await new Promise((resolve, reject)=>{
    res.body.pipe(fileStream);
    res.body.on('error', reject);
    fileStream.on('finish', resolve);
  });
}

app.post('/overlay', async (req,res)=>{
  try{
    const { input, overlay_top_right, overlay_center, center_opacity=0.3, position_top_right="10:10" } = req.body||{};
    if(!input) return res.status(400).json({error:'missing input url'});
    const inFile = tmpfile('mp4'); // works for both image/video with ffmpeg
    const corner = tmpfile('png');
    const center = tmpfile('png');
    const outFile = tmpfile('mp4');

    await downloadTo(input, inFile);
    if(overlay_top_right) await downloadTo(overlay_top_right, corner);
    if(overlay_center) await downloadTo(overlay_center, center);

    // Build filter: overlay corner then center (with opacity)
    const [px,py] = position_top_right.split(':').map(n=>parseInt(n||'10',10));
    const filter = [
      overlay_top_right ? `[0:v][1:v]overlay=W-w-${px}:${py}[tmp1]` : `[0:v]null[tmp1]`,
      overlay_center ? `[2:v]format=rgba,colorchannelmixer=aa=${1.0-center_opacity}[wm];[tmp1][wm]overlay=(W-w)/2:(H-h)/2:format=auto[outv]` : `[tmp1]null[outv]`
    ].join(';');

    const args = ['-y', '-i', inFile];
    if(overlay_top_right) args.push('-i', corner);
    if(overlay_center) args.push('-i', center);
    args.push('-filter_complex', filter, '-map', '[outv]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', outFile);

    const { spawn } = await import('child_process');
    await new Promise((resolve, reject)=>{
      const p = spawn('ffmpeg', args);
      let err='';
      p.stderr.on('data', d=>{ err += d.toString(); });
      p.on('exit', code=> code===0 ? resolve(0) : reject(new Error('ffmpeg failed: '+err)));
    });

    const stat = fs.statSync(outFile);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    const stream = fs.createReadStream(outFile);
    stream.pipe(res);
    stream.on('close', ()=>{
      try{ fs.unlinkSync(inFile); }catch{}
      try{ fs.unlinkSync(corner); }catch{}
      try{ fs.unlinkSync(center); }catch{}
      try{ fs.unlinkSync(outFile); }catch{}
    });
  }catch(e){
    res.status(500).json({error: e.message});
  }
});

app.get('/', (_req,res)=> res.send('FFmpeg overlay worker up'));
const port = process.env.PORT || 8080;
app.listen(port, ()=> console.log('FFmpeg worker listening on', port));
