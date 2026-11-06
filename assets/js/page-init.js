(() => {
  'use strict';
  const view = document.getElementById('view');
  const data = window.BRO_DATA || {articles:[],resources:[]};
  const page = document.body.dataset.page || 'home';
  const params = new URLSearchParams(location.search);
  if (!params.has('id') && document.body.dataset.contentId) params.set('id', document.body.dataset.contentId);
  const articleUrl = id => /^[a-zA-Z0-9_-]+$/.test(String(id)) ? './article-' + id + '.html' : './article.html?id=' + encodeURIComponent(id);
  const resourceUrl = id => /^[a-zA-Z0-9_-]+$/.test(String(id)) ? './resource-' + id + '.html' : './resource.html?id=' + encodeURIComponent(id);
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
  const rendered = window.BRO_RENDER(data, page, params);
  // Preserve the already rendered DOM, including its initial dimensions.
  if (view.dataset.renderKey !== rendered.key) view.innerHTML = rendered.markup;
  document.title = rendered.title;
  if (rendered.description) document.querySelector('meta[name=description]').content = rendered.description;
  document.querySelectorAll('[data-nav]').forEach(a=>{if(a.dataset.nav===page||(page==='article'&&a.dataset.nav==='articles')||(page==='resource'&&a.dataset.nav==='resources'))a.setAttribute('aria-current','page');});
})();
