(() => {
  'use strict';
  const view = document.getElementById('view');
  const data = window.BRO_DATA || {articles:[],resources:[]};
  const articles = data.articles || [], resources = data.resources || [];
  const page = document.body.dataset.page || 'home';
  const params = new URLSearchParams(location.search);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const articleUrl = id => './article.html?id=' + encodeURIComponent(id);
  const resourceUrl = id => './resource.html?id=' + encodeURIComponent(id);
  const date = a => [a.year,a.date].filter(Boolean).join('.');
  const text = html => {const div=document.createElement('div'); div.innerHTML=html || ''; return div.textContent || '';};
  const safeUrl = value => {
    const url = String(value || '').trim();
    if (!url || url === '#' || /[\u0000-\u0020]/.test(url)) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || /^\/\//.test(url)) return '';
    return url;
  };
  // Compatibility for links shared before the move to separate HTML pages.
  if (page === 'home' && location.hash && location.hash !== '#latest') {
    let hash='';try {hash=decodeURIComponent(location.hash.replace(/^#\/?/,''));} catch (_) {}
    let target='';
    if (['articles','resources','about'].includes(hash)) target='./'+hash+'.html';
    else if (hash.startsWith('articles/')) target=articleUrl(hash.slice(9));
    else if (hash.startsWith('resources/')) target=resourceUrl(hash.slice(10));
    else if (hash.startsWith('a:')) target=articleUrl(hash.slice(2));
    else if (hash.startsWith('r:')) target=resourceUrl(hash.slice(2));
    if (target) {location.replace(target);return;}
  }
  const articleRow = a => `<a class="article-row" href="${escape(articleUrl(a.id))}"><h3 class="row-title">${escape(a.title)}</h3><div class="row-meta"><span class="row-date">${escape(date(a))}</span>${a.tag?`<span class="row-tag">${escape(a.tag)}</span>`:''}</div><span class="row-arrow" aria-hidden="true">↗</span></a>`;
  const resourceCard = r => `<a class="resource-card" href="${escape(resourceUrl(r.id))}">${r.mark?`<span class="resource-mark">${escape(r.mark)}</span>`:''}<h2>${escape(r.title)}</h2><p>${escape(r.desc)}</p><span class="resource-type">${r.type==='free'?'免费获取':'查看资源'} <span aria-hidden="true">↗</span></span></a>`;
  const empty = message => `<p class="empty-state">${message}</p>`;
  const heading = (title,description='') => `<div class="page-heading"><h1>${escape(title)}</h1>${description?`<p class="description">${escape(description)}</p>`:''}</div>`;
  let markup='', title='BRO · 世间有价，星空无主';
  if (page === 'home') {
    markup=`<section class="hero" aria-labelledby="hero-title"><div class="sky-day" aria-hidden="true"></div><div class="sky-stars" aria-hidden="true"></div><div class="hero-content"><h1 id="hero-title"><span>世间有价</span><span class="comma">，</span><span>星空无主</span></h1><div class="hero-links"><a href="./articles.html">文章 <span aria-hidden="true">↗</span></a><a href="./resources.html">资源 <span aria-hidden="true">↗</span></a></div></div></section><div class="content-width home-content" id="latest"><section aria-labelledby="latest-heading"><div class="section-heading"><h2 id="latest-heading">最近文章</h2><a class="text-link" href="./articles.html">全部文章 →</a></div>${articles.length?`<div class="article-list">${articles.slice(0,5).map(articleRow).join('')}</div>`:empty('暂无文章。')}</section>${resources.length?`<section class="home-resources"><div class="section-heading"><h2>精选资源</h2><a class="text-link" href="./resources.html">全部资源 →</a></div><div class="resource-grid">${resources.slice(0,3).map(resourceCard).join('')}</div></section>`:''}</div>`;
  } else if (page === 'articles') {
    title='文章 · BRO'; markup=`<section class="page">${heading('文章')}${articles.length?`<div class="article-list">${articles.map(articleRow).join('')}</div>`:empty('暂无文章。')}</section>`;
  } else if (page === 'resources') {
    title='资源 · BRO'; markup=`<section class="page">${heading('资源')}${resources.length?`<div class="resource-grid">${resources.map(resourceCard).join('')}</div>`:empty('暂未发布资源。')}</section>`;
  } else if (page === 'about') {
    title='关于 · BRO'; markup=`<section class="page narrow">${heading('关于')}<div class="prose"><p>这里是 BRO，放点文章、工具和资料。</p><p>有空常来看看。</p></div></section>`;
  } else if (page === 'article') {
    const a=articles.find(a=>String(a.id)===params.get('id'));
    if(a){title=a.title+' · BRO';markup=`<section class="page narrow"><a class="back" href="./articles.html">← 返回文章</a><div class="page-heading"><h1>${escape(a.title)}</h1><p class="article-meta"><span>${escape(date(a))}</span><span>${escape(a.tag)}</span></p></div><article class="prose">${a.body}</article></section>`;}
    else {title='文章未找到 · BRO';markup=`<section class="page">${heading('未找到这篇文章')}<a class="primary-link" href="./articles.html">返回文章列表 →</a></section>`;}
  } else if (page === 'resource') {
    const r=resources.find(r=>String(r.id)===params.get('id'));
    if(r){const url=safeUrl(r.url); title=r.title+' · BRO';markup=`<section class="page narrow"><a class="back" href="./resources.html">← 返回资源</a>${heading(r.title)}<div class="prose"><p>${escape(r.desc)}</p></div>${url?`<a class="primary-link" href="${escape(url)}" ${/^https?:/i.test(url)?'target="_blank" rel="noopener noreferrer"':''}>${r.type==='free'?'获取资源':'前往购买'} <span aria-hidden="true">↗</span></a>`:'<p class="notice">资源地址暂未配置。</p>'}</section>`;}
    else {title='资源未找到 · BRO';markup=`<section class="page">${heading('未找到这项资源')}<a class="primary-link" href="./resources.html">返回资源列表 →</a></section>`;}
  } else if (page === 'search') {
    const query=(params.get('q')||'').trim(), q=query.toLocaleLowerCase();
    const aa=q?articles.filter(a=>(a.title+' '+a.tag+' '+text(a.body)).toLocaleLowerCase().includes(q)):[];
    const rr=q?resources.filter(r=>(r.title+' '+r.desc).toLocaleLowerCase().includes(q)):[];
    title='搜索 · BRO';
    markup=`<section class="page">${heading('搜索',query?`“${query}” · ${aa.length+rr.length} 条结果`:'输入关键词，搜索文章与资源。')}${aa.length?`<div class="section-heading"><h2>文章</h2></div><div class="article-list">${aa.map(articleRow).join('')}</div>`:''}${rr.length?`<div class="home-resources"><div class="section-heading"><h2>资源</h2></div><div class="resource-grid">${rr.map(resourceCard).join('')}</div></div>`:''}${query&&!aa.length&&!rr.length?empty('未找到匹配内容，请尝试其他关键词。'):''}</section>`;
  }
  view.innerHTML=markup;document.title=title;
  const description=document.querySelector('meta[name=description]');
  if(page==='article'){const a=articles.find(a=>String(a.id)===params.get('id'));if(a)description.content=text(a.body).slice(0,150);}
  document.querySelectorAll('[data-nav]').forEach(a=>{if(a.dataset.nav===page||(page==='article'&&a.dataset.nav==='articles')||(page==='resource'&&a.dataset.nav==='resources'))a.setAttribute('aria-current','page');});
  const searchToggle=document.querySelector('.search-toggle'),searchPanel=document.getElementById('search-panel'),searchInput=document.getElementById('search');
  const menuToggle=document.querySelector('.menu-toggle'),menu=document.getElementById('mobile-nav');
  function closeSearch(){searchPanel.hidden=true;searchToggle.setAttribute('aria-expanded','false');}
  function closeMenu(){menu.hidden=true;menuToggle.setAttribute('aria-expanded','false');menuToggle.setAttribute('aria-label','展开导航');}
  searchInput.value=params.get('q')||'';
  searchToggle.addEventListener('click',()=>{const open=searchPanel.hidden;closeMenu();searchPanel.hidden=!open;searchToggle.setAttribute('aria-expanded',String(open));if(open)searchInput.focus();});
  menuToggle.addEventListener('click',()=>{const open=menu.hidden;closeSearch();menu.hidden=!open;menuToggle.setAttribute('aria-expanded',String(open));menuToggle.setAttribute('aria-label',open?'收起导航':'展开导航');});
  document.addEventListener('click',e=>{if(!e.target.closest('.search-panel,.search-toggle'))closeSearch();if(!e.target.closest('.mobile-nav,.menu-toggle'))closeMenu();});
  const mobileMedia=matchMedia('(max-width:600px)');
  if(mobileMedia.addEventListener)mobileMedia.addEventListener('change',e=>{if(!e.matches)closeMenu();});
  // Only images open in a dialog. All content entries use ordinary page links.
  const dialog=document.getElementById('lightbox'),stage=document.getElementById('lightbox-stage'),image=document.getElementById('lightbox-img'),zoom=document.querySelector('[data-toggle-actual]');
  let previousFocus=null;
  function setActual(actual){stage.classList.toggle('actual-size',actual);zoom.textContent=actual?'适应屏幕':'查看原始尺寸';zoom.setAttribute('aria-pressed',String(actual));}
  function closeLightbox(){dialog.close();}
  document.addEventListener('click',e=>{const target=e.target.closest('[data-zoom]');if(!target)return;const img=target.closest('.figure-card')?.querySelector('img')||(target.tagName==='IMG'?target:null);if(!img)return;previousFocus=document.activeElement;image.src=img.src;image.alt=img.alt;setActual(false);dialog.showModal();document.body.classList.add('locked');document.querySelector('[data-close-lightbox]').focus();});
  zoom.addEventListener('click',()=>setActual(!stage.classList.contains('actual-size')));
  image.addEventListener('click',()=>setActual(!stage.classList.contains('actual-size')));
  document.querySelector('[data-close-lightbox]').addEventListener('click',closeLightbox);
  stage.addEventListener('click',e=>{if(e.target===stage)closeLightbox();});
  dialog.addEventListener('close',()=>{document.body.classList.remove('locked');if(previousFocus?.isConnected)previousFocus.focus();});
  document.addEventListener('keydown',e=>{if(e.key!=='Escape'||dialog.open)return;if(!searchPanel.hidden){closeSearch();searchToggle.focus();}else if(!menu.hidden){closeMenu();menuToggle.focus();}});
})();
