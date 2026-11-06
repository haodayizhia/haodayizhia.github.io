(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
  const searchToggle=document.querySelector('.search-toggle'),searchPanel=document.getElementById('search-panel'),searchInput=document.getElementById('search');
  const menuToggle=document.querySelector('.menu-toggle'),menu=document.getElementById('mobile-nav');
  const panelBackdrop=document.querySelector('.panel-backdrop');
  function syncPanels(){panelBackdrop.hidden=searchPanel.hidden&&menu.hidden;}
  function closeSearch(){searchPanel.hidden=true;searchToggle.setAttribute('aria-expanded','false');syncPanels();}
  function closeMenu(){menu.hidden=true;menuToggle.setAttribute('aria-expanded','false');menuToggle.setAttribute('aria-label','展开导航');syncPanels();}
  searchInput.value=params.get('q')||'';
  searchToggle.addEventListener('click',()=>{const open=searchPanel.hidden;closeMenu();searchPanel.hidden=!open;searchToggle.setAttribute('aria-expanded',String(open));syncPanels();if(open)searchInput.focus();});
  menuToggle.addEventListener('click',()=>{const open=menu.hidden;closeSearch();menu.hidden=!open;menuToggle.setAttribute('aria-expanded',String(open));menuToggle.setAttribute('aria-label',open?'收起导航':'展开导航');syncPanels();if(open)menu.querySelector('a').focus();});
  document.addEventListener('click',e=>{if(!e.target.closest('.search-panel,.search-toggle'))closeSearch();if(!e.target.closest('.mobile-nav,.menu-toggle'))closeMenu();});
  const mobileMedia=matchMedia('(max-width:600px)');
  if(mobileMedia.addEventListener)mobileMedia.addEventListener('change',e=>{if(!e.matches)closeMenu();});
  const tocLinks=[...document.querySelectorAll('[data-toc-link]')];
  const sections=[...document.querySelectorAll('.reading-content h2[id]')];
  if(tocLinks.length&&sections.length){
    let pending=false;
    function updateToc(){
      pending=false;
      let current=sections[0];
      for(const section of sections){if(section.getBoundingClientRect().top<=160)current=section;else break;}
      for(const link of tocLinks){if(link.hash==='#'+current.id)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}
    }
    function scheduleToc(){if(!pending){pending=true;requestAnimationFrame(updateToc);}}
    window.addEventListener('scroll',scheduleToc,{passive:true});
    window.addEventListener('resize',scheduleToc,{passive:true});
    for(const link of tocLinks)link.addEventListener('click',()=>{const panel=link.closest('details');if(panel)panel.open=false;});
    updateToc();
  }
  // Only images open in a dialog. All content entries use ordinary page links.
  const dialog=document.getElementById('lightbox'),stage=document.getElementById('lightbox-stage'),image=document.getElementById('lightbox-img'),zoom=document.querySelector('[data-toggle-actual]');
  let previousFocus=null,lightboxScroll=null,previousScrollBehavior="";
  function setActual(actual){stage.classList.toggle('actual-size',actual);zoom.textContent=actual?'适应屏幕':'查看原始尺寸';zoom.setAttribute('aria-pressed',String(actual));}
  function closeLightbox(){dialog.close();}
  document.addEventListener('click',e=>{const target=e.target.closest('[data-zoom]');if(!target)return;const img=target.closest('.figure-card')?.querySelector('img')||(target.tagName==='IMG'?target:null);if(!img)return;lightboxScroll={left:scrollX,top:scrollY};previousScrollBehavior=document.documentElement.style.scrollBehavior;document.documentElement.style.scrollBehavior="auto";window.scrollTo(lightboxScroll.left,lightboxScroll.top);document.documentElement.classList.add("image-locked");previousFocus=target.tagName==="BUTTON"?target:img;if(previousFocus===img)img.tabIndex=-1;previousFocus.focus({preventScroll:true});image.src=img.src;image.alt=img.alt;setActual(false);dialog.showModal();document.body.classList.add('locked');document.querySelector('[data-close-lightbox]').focus();});
  zoom.addEventListener('click',()=>setActual(!stage.classList.contains('actual-size')));
  image.addEventListener('click',()=>setActual(!stage.classList.contains('actual-size')));
  document.querySelector('[data-close-lightbox]').addEventListener('click',closeLightbox);
  stage.addEventListener('click',e=>{if(e.target===stage)closeLightbox();});
  dialog.addEventListener('close',()=>{document.body.classList.remove('locked');document.documentElement.classList.remove('image-locked');if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});if(lightboxScroll)window.scrollTo(lightboxScroll.left,lightboxScroll.top);document.documentElement.style.scrollBehavior=previousScrollBehavior;lightboxScroll=null;});
  document.addEventListener('keydown',e=>{if(e.key!=='Escape'||dialog.open)return;if(!searchPanel.hidden){closeSearch();searchToggle.focus();}else if(!menu.hidden){closeMenu();menuToggle.focus();}});
})();
