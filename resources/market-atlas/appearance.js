'use strict';
const atlasRoot=document.querySelector('.atlas-app');
const atlasLight=()=>document.documentElement.dataset.theme!=='dark';
// Keep categorical and red/green financial colors while giving text/grid readable light variants.
function atlasColor(hex){
 if(!atlasLight())return hex;
 let s=hex.slice(1);if(s.length===3)s=[...s].map(v=>v+v).join('');
 const rgb=[0,2,4].map(i=>parseInt(s.slice(i,i+2),16)),[r,g,b]=rgb;
 const max=Math.max(...rgb),min=Math.min(...rgb),lum=.2126*r+.7152*g+.0722*b,alpha=s.length===8?s.slice(6):'';
 if(lum<90)return'#d5dfec'+alpha;
 if(max-min<26)return'#243a56'+alpha;
 if(b>=r&&b>=g&&max-min<75)return'#60758e'+alpha;
 return'#'+rgb.map(v=>Math.round(v*.62).toString(16).padStart(2,'0')).join('')+alpha;
}
