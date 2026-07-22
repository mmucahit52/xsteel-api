"use strict";
/* XSTEEL Skor API — sıfır bağımlılık (Node 22+, node:sqlite) */
const http = require('http');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const DB_PATH = fs.existsSync('/data') ? '/data/scores.db' : './scores.db';
const ALLOWED_ORIGINS = ['https://xsteel.fun', 'https://www.xsteel.fun', 'http://localhost'];
const GAMES = { tower: { maxScore: 50000 }, runner: { maxScore: 200000 } };

const db = new DatabaseSync(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS scores(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  name TEXT NOT NULL,
  score INTEGER NOT NULL,
  extra TEXT,
  ip TEXT,
  ts INTEGER NOT NULL
)`);
db.exec('CREATE INDEX IF NOT EXISTS idx_scores ON scores(game, score DESC)');

const insertStmt = db.prepare('INSERT INTO scores(game,name,score,extra,ip,ts) VALUES(?,?,?,?,?,?)');
const topStmt = db.prepare(`
  SELECT name, MAX(score) AS score, extra, MAX(ts) AS ts
  FROM scores WHERE game = ?
  GROUP BY LOWER(name)
  ORDER BY score DESC
  LIMIT ?`);

/* basit IP hız limiti: dakikada 10 gönderim */
const rl = new Map();
function limited(ip){
  const now = Date.now();
  const arr = (rl.get(ip)||[]).filter(t=>now-t<60000);
  if(arr.length>=10){ rl.set(ip,arr); return true; }
  arr.push(now); rl.set(ip,arr);
  if(rl.size>5000) rl.clear();
  return false;
}

function cors(req,res){
  const o = req.headers.origin||'';
  const ok = ALLOWED_ORIGINS.some(a=>o===a||o.startsWith(a+':'));
  res.setHeader('Access-Control-Allow-Origin', ok? o : ALLOWED_ORIGINS[0]);
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
}
function send(res,code,obj){
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req,res)=>{
  cors(req,res);
  if(req.method==='OPTIONS'){ res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://x');

  if(req.method==='GET' && url.pathname==='/health') return send(res,200,{ok:true});

  if(req.method==='GET' && url.pathname==='/top'){
    const game = url.searchParams.get('game');
    if(!GAMES[game]) return send(res,400,{error:'game?'});
    const limit = Math.min(100, parseInt(url.searchParams.get('limit')||'50',10)||50);
    const rows = topStmt.all(game, limit);
    return send(res,200,{game, top: rows.map(r=>({name:r.name, score:r.score, extra:r.extra}))});
  }

  if(req.method==='POST' && url.pathname==='/score'){
    let body='';
    req.on('data',c=>{ body+=c; if(body.length>2048) req.destroy(); });
    req.on('end',()=>{
      try{
        const ip = (req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
        if(limited(ip)) return send(res,429,{error:'yavaş'});
        const d = JSON.parse(body||'{}');
        const game = String(d.game||'');
        if(!GAMES[game]) return send(res,400,{error:'game?'});
        let name = String(d.name||'Oyuncu').replace(/[^\p{L}\p{N} _.\-]/gu,'').slice(0,14).trim() || 'Oyuncu';
        const score = Math.floor(Number(d.score));
        if(!Number.isFinite(score) || score<1 || score>GAMES[game].maxScore) return send(res,400,{error:'score?'});
        const extra = String(d.extra||'').slice(0,40);
        insertStmt.run(game, name, score, extra, ip, Date.now());
        return send(res,200,{ok:true});
      }catch(e){ return send(res,400,{error:'bad json'}); }
    });
    return;
  }

  send(res,404,{error:'not found'});
});
server.listen(PORT, ()=>console.log('XSTEEL API listening on '+PORT+' db='+DB_PATH));
