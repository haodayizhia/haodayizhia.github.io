'use strict';
function redrawAtlas(){
 if(!state.market)return;setMarketSeries();industryHeatCache=null;resizePlots();
 for(const pane of state.panes.values()){pane.chart.backgroundKey=null;if(pane.heat)pane.heat.drawKey=null;pane.setSeries();pane.renderFrame();pane.chart.resize();pane.heat?.resize();}
 if(stockDetail.el.open)stockDetail.draw();
}
window.addEventListener('bro:themechange',()=>requestAnimationFrame(redrawAtlas));
// The shared theme controller also restores the theme from browser history.
new MutationObserver(()=>requestAnimationFrame(redrawAtlas)).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
boot();
