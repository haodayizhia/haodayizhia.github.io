(() => {
  'use strict';
  const params = new URLSearchParams(location.search);
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
