import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
ffmpeg.setFfmpegPath(ffmpegPath);

export async function addWatermark(inputPath, cornerPath, centerPath, pos='top-right'){
  const out = inputPath.replace(/(\.[a-zA-Z0-9]+)$/, '_wm$1');
  const posExpr = pos==='top-right' ? 'overlay=main_w-overlay_w-24:24' :
                  pos==='top-left'  ? 'overlay=24:24' :
                  pos==='bottom-left' ? 'overlay=24:main_h-overlay_h-24' :
                  'overlay=main_w-overlay_w-24:main_h-overlay_h-24';
  return new Promise((resolve,reject)=>{
    ffmpeg(inputPath)
      .input(centerPath)
      .input(cornerPath)
      .complexFilter([
        '[0:v][1:v]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:format=auto[withcenter]',
        `[withcenter][2:v]${posExpr}:format=auto[outv]`
      ])
      .outputOptions(['-map [outv]','-map 0:a?','-c:v libx264','-crf 22','-preset veryfast','-c:a copy'])
      .save(out)
      .on('end', ()=> resolve(out))
      .on('error', reject);
  });
}
