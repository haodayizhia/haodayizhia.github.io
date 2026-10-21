(() => {
  const root = document.getElementById('bro');
  const view = document.getElementById('view');
  const search = document.getElementById('search');
  const rotor = document.getElementById('rotor');
  const lightbox = document.getElementById('lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxStage = document.getElementById('lightbox-stage');
  const zoomToggleBtn = document.getElementById('lightbox-zoom-toggle');

  const siteData = window.BRO_DATA || { articles: [], resources: [] };
  const articles = siteData.articles || [];
  const resources = siteData.resources || [];

  // 解析地址栏 #hash，实现浏览器「后退 / 前进」、页面刷新保持原位、以及文章直链分享
  function pageFromHash() {
    const raw = decodeURIComponent(window.location.hash.replace(/^#\/?/, '')).trim();
    if (!raw || raw === 'home') return 'home';
    if (raw === 'articles' || raw === 'resources' || raw === 'about') return raw;
    if (raw.startsWith('a:') && articles.some(x => x.id === raw.slice(2))) return raw;
    if (raw.startsWith('r:') && resources.some(x => x.id === raw.slice(2))) return raw;
    return 'home';
  }

  let page = pageFromHash();
  let lastListPage = 'home';
  let turns = 0;

  const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const articleRow = a => `<button class="article-row" data-open="a:${a.id}"><span class="row-left"><span class="name">${escapeHTML(a.title)}</span><span class="tag-badge">${escapeHTML(a.tag)}</span></span><span class="date">${escapeHTML(a.date)}</span></button>`;

  function cover(r) {
    const index = resources.indexOf(r) + 1;
    return `<span class="cover"><span class="cover-label">BRO / RESOURCE</span><span class="cover-text">${escapeHTML(r.mark)}</span><span class="cover-no">${String(index).padStart(2,'0')}</span></span>`;
  }
  const card = r => `<button class="card" data-open="r:${r.id}">${cover(r)}<span class="card-title">${escapeHTML(r.title)}</span></button>`;
  const sponsor = () => `<section class="sponsor"><h2>请兄弟喝杯水</h2><p class="hint">随意赞助，不影响免费获取。</p><div class="qr">赞助二维码<br>待添加</div></section>`;

  function setActualSize(actual) {
    lightboxStage.classList.toggle('actual-size', actual);
    if (zoomToggleBtn) {
      zoomToggleBtn.classList.toggle('active', actual);
      zoomToggleBtn.textContent = actual ? '📐 适应屏幕宽度' : '🔍 1:1 原始超清尺寸 (1920px)';
    }
  }

  function openLightbox(src, alt) {
    if (src) lightboxImg.src = src;
    if (alt) lightboxImg.alt = alt;
    setActualSize(false);
    lightbox.classList.add('open');
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    let html = '';
    if (query) {
      const matchingArticles = articles.filter(a => (a.title + a.tag).toLowerCase().includes(query));
      const matchingResources = resources.filter(r => (r.title + r.desc).toLowerCase().includes(query));
      html = `<section class="page"><h1>搜索结果</h1><p class="description">找到 ${matchingArticles.length + matchingResources.length} 条内容</p>${matchingArticles.map(articleRow).join('')}${matchingResources.length ? `<div class="cards" style="margin-top:20px">${matchingResources.map(card).join('')}</div>` : ''}${!matchingArticles.length && !matchingResources.length ? '<div class="empty-box">未找到匹配的文章或资源。</div>' : ''}</section>`;
    } else if (page === 'home') {
      const resourceSection = resources.length
        ? `<section class="section"><div class="sectionbar"><h2>精选资源</h2><button class="more" data-page="resources">全部 →</button></div><div class="cards">${resources.slice(0,3).map(card).join('')}</div></section>`
        : '';
      html = `<section class="hero"><h1>世间有价，星空无主</h1><p class="subtitle">嘤其鸣矣，求其友声</p><div class="broline"><span><b class="initial">B</b> Build · 创造</span><span><b class="initial">R</b> Reason · 理性</span><span><b class="initial">O</b> Open · 开放</span></div></section><section class="section"><div class="sectionbar"><h2>最近文章</h2><button class="more" data-page="articles">全部 →</button></div>${articles.length ? articles.map(articleRow).join('') : '<div class="empty-box">暂无文章。</div>'}</section>${resourceSection}`;
    } else if (page === 'articles') {
      html = `<section class="page"><h1>文章</h1><p class="description">想到什么有用的，就写下来。</p>${articles.length ? articles.map(articleRow).join('') : '<div class="empty-box">暂无文章。</div>'}</section>`;
    } else if (page === 'resources') {
      html = `<section class="page"><h1>资源</h1><p class="description">一些能用得上的东西。</p>${resources.length ? `<div class="cards">${resources.map(card).join('')}</div>` : '<div class="empty-box">暂未上架公开资源，后续更新敬请期待。</div>'}</section>`;
    } else if (page === 'about') {
      html = `<section class="page"><h1>关于</h1><div class="prose"><p>这里是 BRO，放点文章、工具和资料。</p><p>有空常来看看。</p></div>${sponsor()}</section>`;
    } else if (page.startsWith('a:')) {
      const a = articles.find(x => x.id === page.slice(2));
      if (!a) return;
      const yearPrefix = a.year ? `${a.year}.` : '2026.';
      const backTarget = lastListPage === 'home' ? 'home' : 'articles';
      const backLabel = lastListPage === 'home' ? '← 返回首页' : '← 返回文章列表';
      html = `<section class="page"><button class="back" data-back="${backTarget}">${backLabel}</button><h1>${escapeHTML(a.title)}</h1><p class="description"><span>${escapeHTML(yearPrefix + a.date)}</span><span class="tag-badge">${escapeHTML(a.tag)}</span></p><article class="prose">${a.body}</article></section>`;
    } else if (page.startsWith('r:')) {
      const r = resources.find(x => x.id === page.slice(2));
      if (!r) return;
      const backTarget = lastListPage === 'home' ? 'home' : 'resources';
      const backLabel = lastListPage === 'home' ? '← 返回首页' : '← 返回资源列表';
      html = `<section class="page"><button class="back" data-back="${backTarget}">${backLabel}</button><div class="detail-cover">${cover(r)}</div><h1>${escapeHTML(r.title)}</h1><div class="prose"><p>${escapeHTML(r.desc)}</p></div><button class="primary" data-action="${r.id}">${r.type === 'free' ? '获取资源' : '前往购买'}</button>${r.type === 'free' ? sponsor() : '<p class="hint">具体价格以购买页面为准。</p>'}<div id="notice"></div></section>`;
    }
    view.innerHTML = html;
    root.querySelectorAll('nav button').forEach(b => {
      const active = b.dataset.page === page || (page.startsWith('a:') && b.dataset.page === 'articles') || (page.startsWith('r:') && b.dataset.page === 'resources');
      b.classList.toggle('current', active);
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }

  // 路由跳转：同步写入浏览器历史记录栈（History API），让浏览器后退/前进键生效
  function go(p, pushHistory = true) {
    if (page === 'home' || page === 'articles' || page === 'resources') {
      lastListPage = page;
    }
    page = p;
    search.value = '';
    if (pushHistory) {
      const targetHash = p === 'home' ? '#home' : `#${p}`;
      if (window.location.hash !== targetHash) {
        try {
          window.history.pushState({ page: p }, '', targetHash);
        } catch (e) {
          window.location.hash = targetHash;
        }
      }
    }
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // 监听浏览器原生「后退 / 前进」按钮、鼠标侧键或手机侧滑返回
  window.addEventListener('popstate', event => {
    if (lightbox.classList.contains('open')) {
      lightbox.classList.remove('open');
    }
    const targetPage = (event.state && event.state.page) ? event.state.page : pageFromHash();
    go(targetPage, false);
  });

  window.addEventListener('hashchange', () => {
    const targetPage = pageFromHash();
    if (targetPage !== page) {
      go(targetPage, false);
    }
  });

  // 初始化当前历史记录状态
  try {
    window.history.replaceState({ page }, '', page === 'home' ? window.location.pathname + window.location.search : `#${page}`);
  } catch (e) {}

  root.addEventListener('click', event => {
    const zoomTarget = event.target.closest('[data-zoom]');
    if (zoomTarget) {
      const figure = zoomTarget.closest('.figure-card');
      const img = figure ? figure.querySelector('img') : zoomTarget;
      openLightbox(img ? img.getAttribute('src') : '', img ? img.getAttribute('alt') : '');
      return;
    }
    if (event.target.closest('[data-toggle-actual]')) {
      setActualSize(!lightboxStage.classList.contains('actual-size'));
      return;
    }
    if (event.target === lightboxImg) {
      setActualSize(!lightboxStage.classList.contains('actual-size'));
      return;
    }
    if (event.target === lightbox || event.target === lightboxStage || event.target.closest('[data-close-lightbox]')) {
      lightbox.classList.remove('open');
      return;
    }
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    if (button.hasAttribute('data-theme')) {
      turns++;
      rotor.style.transform = `rotate(${turns * 180}deg)`;
      const dark = turns % 2 === 1;
      root.classList.toggle('night', dark);
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? '切换日间模式' : '切换夜间模式');
      document.querySelector('meta[name="theme-color"]').content = dark ? '#0b1120' : '#f8fafc';
    } else if (button.dataset.back) {
      if (window.history.state && window.history.length > 1) {
        window.history.back();
      } else {
        go(button.dataset.back);
      }
    } else if (button.dataset.page) {
      go(button.dataset.page);
    } else if (button.dataset.open) {
      go(button.dataset.open);
    } else if (button.dataset.action) {
      const r = resources.find(x => x.id === button.dataset.action);
      if (r && r.url && /^https?:\/\//i.test(r.url)) window.open(r.url, '_blank', 'noopener,noreferrer');
      else {
        const notice = document.getElementById('notice');
        if (notice) notice.innerHTML = '<div class="notice" role="status">目前是演示资源，真实地址尚未配置。</div>';
      }
    }
  });

  search.addEventListener('input', render);
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (lightbox.classList.contains('open')) lightbox.classList.remove('open');
      else if (search.value) { search.value = ''; render(); }
    }
  });
  render();
})();
