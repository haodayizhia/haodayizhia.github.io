// Shared by the build and browser so initial HTML and interactive results agree.
(function (root) {
  'use strict';
  function render(data, page, query = '') {
  const articles = data.articles || [], resources = data.resources || [];
  const params = new URLSearchParams(query);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const articleUrl = id => /^[a-zA-Z0-9_-]+$/.test(String(id)) ? './article-' + id + '.html' : './article.html?id=' + encodeURIComponent(id);
  const resourceUrl = id => /^[a-zA-Z0-9_-]+$/.test(String(id)) ? './resource-' + id + '.html' : './resource.html?id=' + encodeURIComponent(id);
  const date = a => [a.year,a.date].filter(Boolean).join('.');
  const text = html => String(html || '').replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity[0] === '#') return String.fromCodePoint(parseInt(entity.slice(entity[1].toLowerCase() === 'x' ? 2 : 1), entity[1].toLowerCase() === 'x' ? 16 : 10));
    return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[entity.toLowerCase()];
  });
  const safeUrl = value => {
    const url = String(value || '').trim();
    if (!url || url === '#' || /[\u0000-\u0020]/.test(url)) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || /^\/\//.test(url)) return '';
    return url;
  };
  const articleRow = a => `<a class="article-row" href="${escape(articleUrl(a.id))}"><h3 class="row-title">${escape(a.title)}</h3><div class="row-meta"><span class="row-date">${escape(date(a))}</span>${a.tag?`<span class="row-tag">${escape(a.tag)}</span>`:''}</div><span class="row-arrow" aria-hidden="true">↗</span></a>`;
  const resourceCard = r => `<a class="resource-card" href="${escape(resourceUrl(r.id))}">${r.mark?`<span class="resource-mark">${escape(r.mark)}</span>`:''}<h2>${escape(r.title)}</h2><p>${escape(r.desc)}</p><span class="resource-type">${r.type==='free'?'免费获取':'查看资源'} <span aria-hidden="true">↗</span></span></a>`;
  const empty = message => `<p class="empty-state">${message}</p>`;
  const titleMarkup = title => {
    const parts = String(title).match(/^(.+?[)）])\s+(.+)$/);
    return parts ? `<span class="title-part">${escape(parts[1])}</span> <span class="title-part">${escape(parts[2])}</span>` : escape(title);
  };
  const heading = (title, description = '', context = {}) => `<header class="page-heading"><nav class="page-context" aria-label="面包屑"><a class="back" href="${escape(context.href || './index.html')}">${escape(context.parent || '首页')}</a><span aria-hidden="true">/</span><span>${escape(context.label || title)}</span></nav><h1>${titleMarkup(title)}</h1><div class="page-summary">${context.meta || (description ? `<p class="description">${escape(description)}</p>` : '')}</div></header>`;
  let markup='', title='BRO · 世间有价，星空无主';
  if (page === 'home') {
    markup=`<section class="hero" aria-labelledby="hero-title"><div class="sky-day" aria-hidden="true"></div><div class="sky-stars" aria-hidden="true"></div><div class="hero-content"><h1 id="hero-title"><span>世间有价</span><span class="comma">，</span><span>星空无主</span></h1><div class="hero-links"><a href="./articles.html">文章 <span aria-hidden="true">↗</span></a><a href="./resources.html">资源 <span aria-hidden="true">↗</span></a></div></div></section><div class="content-width home-content" id="latest"><section aria-labelledby="latest-heading"><div class="section-heading"><h2 id="latest-heading">最近文章</h2><a class="text-link" href="./articles.html">全部文章 →</a></div>${articles.length?`<div class="article-list">${articles.slice(0,5).map(articleRow).join('')}</div>`:empty('暂无文章。')}</section>${resources.length?`<section class="home-resources"><div class="section-heading"><h2>精选资源</h2><a class="text-link" href="./resources.html">全部资源 →</a></div><div class="resource-grid">${resources.slice(0,3).map(resourceCard).join('')}</div></section>`:''}</div>`;
  } else if (page === 'articles') {
    title='文章 · BRO'; markup=`<section class="page">${heading('文章')}${articles.length?`<div class="article-list">${articles.map(articleRow).join('')}</div>`:empty('暂无文章。')}</section>`;
  } else if (page === 'resources') {
    title='资源 · BRO'; markup=`<section class="page">${heading('资源')}${resources.length?`<div class="resource-grid">${resources.map(resourceCard).join('')}</div>`:empty('暂未发布资源。')}</section>`;
  } else if (page === 'about') {
    title='关于 · BRO'; markup=`<section class="page">${heading('关于')}<div class="prose reading-content"><p>这里是 BRO，放点文章、工具和资料。</p><p>有空常来看看。</p></div></section>`;
  } else if (page === 'article') {
    const a=articles.find(a=>String(a.id)===params.get('id'));
    if(a){title=a.title+' · BRO';markup=`<section class="page">${heading(a.title,'',{parent:'文章',href:'./articles.html',label:'正文',meta:`<p class="article-meta"><span>${escape(date(a))}</span><span>${escape(a.tag)}</span></p>`})}<article class="prose reading-content">${a.body}</article></section>`;}
    else {title='文章未找到 · BRO';markup=`<section class="page">${heading('未找到这篇文章')}<a class="primary-link" href="./articles.html">返回文章列表 →</a></section>`;}
  } else if (page === 'resource') {
    const r=resources.find(r=>String(r.id)===params.get('id'));
    if(r){const url=safeUrl(r.url); title=r.title+' · BRO';markup=`<section class="page">${heading(r.title,'',{parent:'资源',href:'./resources.html',label:'详情'})}<div class="prose reading-content"><p>${escape(r.desc)}</p></div>${url?`<a class="primary-link" href="${escape(url)}" ${/^https?:/i.test(url)?'target="_blank" rel="noopener noreferrer"':''}>${r.type==='free'?'获取资源':'前往购买'} <span aria-hidden="true">↗</span></a>`:'<p class="notice">资源地址暂未配置。</p>'}</section>`;}
    else {title='资源未找到 · BRO';markup=`<section class="page">${heading('未找到这项资源')}<a class="primary-link" href="./resources.html">返回资源列表 →</a></section>`;}
  } else if (page === 'search') {
    const query=(params.get('q')||'').trim(), q=query.toLocaleLowerCase();
    const aa=q?articles.filter(a=>(a.title+' '+a.tag+' '+text(a.body)).toLocaleLowerCase().includes(q)):[];
    const rr=q?resources.filter(r=>(r.title+' '+r.desc).toLocaleLowerCase().includes(q)):[];
    title='搜索 · BRO';
    markup=`<section class="page">${heading('搜索',query?`“${query}” · ${aa.length+rr.length} 条结果`:'输入关键词，搜索文章与资源。')}${aa.length?`<div class="section-heading"><h2>文章</h2></div><div class="article-list">${aa.map(articleRow).join('')}</div>`:''}${rr.length?`<div class="home-resources"><div class="section-heading"><h2>资源</h2></div><div class="resource-grid">${rr.map(resourceCard).join('')}</div></div>`:''}${query&&!aa.length&&!rr.length?empty('未找到匹配内容，请尝试其他关键词。'):''}</section>`;
  }
  const item = page === 'article' ? articles.find(a => String(a.id) === params.get('id')) : null;
  const key = page + ':' + (page === 'search' ? (params.get('q') || '') : ['article','resource'].includes(page) ? (params.get('id') || '') : '');
  return {markup, title, key, description: item ? text(item.body).slice(0,150) : ''};
  }
  if (typeof module === 'object' && module.exports) module.exports = render;
  else root.BRO_RENDER = render;
})(globalThis);
