import express from 'express';
import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';

export function attachWeb(app){
  if(process.env.WEB_ENABLED!=='true') return;
  const router = express.Router();
  const feedPath = 'web/feed.json';
  const metricsPath = 'web/metrics.json';
  fs.ensureFileSync(feedPath); if(!(fs.readFileSync(feedPath,'utf8')||'').trim()) fs.writeFileSync(feedPath,'[]');
  fs.ensureFileSync(metricsPath); if(!(fs.readFileSync(metricsPath,'utf8')||'').trim()) fs.writeFileSync(metricsPath,'{}');

  // Static
  router.use('/static', express.static('web/static', { maxAge: '7d' }));

  // Mirror page
  router.get('/mirror/:id', async (req,res)=>{
    const items = JSON.parse(await fs.readFile(feedPath,'utf8')||'[]');
    const it = items.find(x=>x.id===req.params.id);
    if(!it) return res.status(404).send('Not found');
    const base = process.env.WEB_BASEURL || '';
    const html = `<!doctype html><html lang="he"><head>
<meta charset="utf-8"><title>${it.title}</title>
<meta name="description" content="${(it.summary||'').slice(0,160)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${it.title}">
<meta property="og:description" content="${(it.summary||'').slice(0,200)}">
<meta property="og:url" content="${base}/mirror/${it.id}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${it.title}">
<meta name="twitter:description" content="${(it.summary||'').slice(0,200)}">
</head><body><h1>${it.title}</h1><p>${it.summary||''}</p></body></html>`;
    res.status(200).send(html);
  });

  // Sitemap
  router.get('/sitemap.xml', async (req,res)=>{
    const base = process.env.WEB_BASEURL || '';
    const items = JSON.parse(await fs.readFile(feedPath,'utf8')||'[]');
    const urls = items.map(it=>`<url><loc>${base}/mirror/${it.id}</loc><lastmod>${new Date(it.ts).toISOString()}</lastmod></url>`).join('');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  });

  // Metrics APIs
  router.get('/api/metrics', async (req,res)=>{
    const data = JSON.parse(await fs.readFile(metricsPath,'utf8')||'{}');
    res.json({ ok:true, data });
  });
  router.post('/api/events', express.json(), async (req,res)=>{
    const ev = req.body || {}; ev.ts = Date.now();
    const data = JSON.parse(await fs.readFile(metricsPath,'utf8')||'{}');

    const day = new Date().toISOString().slice(0,10);
    data.days = data.days || {};
    data.days[day] = data.days[day] || { posts:0, media:0, text:0, crosspost:0, errors:0 };
    if(ev.type==='post_text') data.days[day].posts++, data.days[day].text++;
    if(ev.type==='post_media') data.days[day].posts++, data.days[day].media++;
    if(ev.type==='crosspost') data.days[day].crosspost++;
    if(ev.type==='error') data.days[day].errors++;

    await fs.writeFile(metricsPath, JSON.stringify(data,null,2));
    res.json({ ok:true });
  });

  // Dashboard page
  router.get('/dashboard', async (req,res)=>{
    res.sendFile(path.resolve('dashboard/index.html'));
  });

  app.use('/', router);

  // Helpers exposed to bot
  app.locals.webAppend = async (item)=>{
    const arr = JSON.parse(await fs.readFile(feedPath,'utf8')||'[]');
    arr.unshift(item); while(arr.length>300) arr.pop();
    await fs.writeFile(feedPath, JSON.stringify(arr,null,2));
  };
  app.locals.saveStatic = async (filename, buf)=>{
    const out = path.join('web','static', filename);
    await fs.writeFile(out, buf);
    return `/static/${filename}`;
  };
  app.locals.logEvent = async (type, payload={})=>{
    try {
      await fetch((process.env.WEB_BASEURL||'') + '/api/events', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({type, payload})
      });
    } catch(e){ /* noop in local mode */ }
  }
}
