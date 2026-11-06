'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const init=fs.readFileSync(path.join(__dirname,'../assets/js/theme-init.js'),'utf8');
const control=fs.readFileSync(path.join(__dirname,'../assets/js/theme.js'),'utf8');

// Run the shipped browser scripts with persistent origin storage and separate
// tab sessions. Frozen documents deliberately receive no storage events.
function browser({blocked=[]}={}){
  const local=new Map(),cookies=new Map(),pages=new Set();
  function page({session=new Map(),type='navigate'}={}){
    const listeners=new Map(),documentListeners=new Map(),buttonListeners=new Map(),attributes=new Map();
    const classes=new Set();
    const html={dataset:{},style:{},classList:{contains:value=>classes.has(value),add:value=>classes.add(value),remove:value=>classes.delete(value)}};
    const button={setAttribute:(key,value)=>attributes.set(key,value),getAttribute:key=>attributes.get(key),addEventListener:(type,fn)=>buttonListeners.set(type,fn)};
    const meta={content:'#03070d'};
    const document={documentElement:html,visibilityState:'visible',querySelector:selector=>selector==='button[data-theme]'?button:selector==='meta[name="theme-color"]'?meta:null,addEventListener:(type,fn)=>documentListeners.set(type,fn)};
    Object.defineProperty(document,'cookie',{
      get:()=>[...cookies].map(([key,value])=>key+'='+value).join('; '),
      set:value=>{const [key,...rest]=value.split(';')[0].split('=');cookies.set(key,rest.join('='));},
    });
    const current={frozen:false,session,html,button,meta};
    current.emit=(type,event={})=>{for(const fn of listeners.get(type)||[])fn(event);};
    function storage(name,data){
      const check=()=>{if(blocked.includes(name))throw new Error('Storage access denied');};
      const notify=key=>{if(name==='localStorage')for(const other of pages)if(other!==current&&!other.frozen)other.emit('storage',{key});};
      return {
        getItem(key){check();return data.get(key)??null;},
        setItem(key,value){check();const changed=data.get(key)!==value;data.set(key,value);if(changed)notify(key);},
        removeItem(key){check();if(data.delete(key))notify(key);},
      };
    }
    const globals={
      document,localStorage:storage('localStorage',local),sessionStorage:storage('sessionStorage',session),
      location:{protocol:'https:'},performance:{getEntriesByType:()=>[{type}]},
      CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},
      requestAnimationFrame:fn=>fn(),
      addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},
      dispatchEvent:event=>current.emit(event.type,event),
    };
    globals.window=globals;
    const context=vm.createContext(globals);
    vm.runInContext(init,context,{filename:'theme-init.js'});
    current.firstTheme=html.dataset.theme;
    vm.runInContext(control,context,{filename:'theme.js'});
    current.click=()=>buttonListeners.get('click')();
    current.show=()=>{current.frozen=false;current.emit('pageshow',{persisted:true});};
    pages.add(current);
    return current;
  }
  return {page,local};
}
function expect(page,mode){
  assert.equal(page.html.dataset.theme,mode);
  assert.equal(page.html.style.colorScheme,mode);
  assert.equal(page.button.getAttribute('aria-pressed'),String(mode==='dark'));
  assert.equal(page.meta.content,mode==='light'?'#eef3fc':'#03070d');
}

test('first visit defaults to night',()=>expect(browser().page(),'dark'));
test('manual choice survives navigation, refresh and new tab before first paint',()=>{
  const origin=browser(),first=origin.page();first.click();expect(first,'light');
  for(const options of [{session:first.session},{session:first.session,type:'reload'},{}]){
    const next=origin.page(options);expect(next,'light');assert.equal(next.firstTheme,'light');
  }
});
test('night is remembered too',()=>{
  const origin=browser(),first=origin.page();first.click();first.click();
  expect(origin.page({type:'reload'}),'dark');
});
test('other tabs update their document and control together',()=>{
  const origin=browser(),first=origin.page(),second=origin.page();
  first.click();expect(second,'light');second.click();expect(first,'dark');
});
test('history restoration synchronizes a document that was frozen',()=>{
  const origin=browser(),old=origin.page();old.frozen=true;
  const next=origin.page({session:old.session});next.click();
  expect(old,'dark');old.show();expect(old,'light');
  old.frozen=true;next.click();old.show();expect(old,'dark');
});
test('legacy session choice migrates to a persistent origin choice',()=>{
  const origin=browser();const legacy=origin.page({session:new Map([['bro-theme','light']])});
  expect(legacy,'light');assert.equal(legacy.firstTheme,'light');
  expect(origin.page(),'light');
});
for(const blocked of [['localStorage'],['localStorage','sessionStorage']]){
  test('theme fallback works with '+blocked.join(' and ')+' unavailable',()=>{
    const origin=browser({blocked}),first=origin.page();first.click();
    expect(origin.page({session:first.session,type:'reload'}),'light');
    const next=origin.page();expect(next,'light');assert.equal(next.firstTheme,'light');
  });
}
