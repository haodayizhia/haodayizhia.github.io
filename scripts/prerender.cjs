'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createHash} = require('node:crypto');
const root = path.resolve(__dirname, '..');
const render = require(path.join(root, 'assets/js/render.js'));
const sandbox = {window: {}};
vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/data.js'), 'utf8'), sandbox);
const data = sandbox.window.BRO_DATA;
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function build(template, page, query = '', id) {
  const result = render(data, page, query);
  let source = template.replace(/<main\b[^>]*>[\s\S]*?<\/main>/, () => `<main id="view" tabindex="-1" data-render-key="${escape(result.key)}">${result.markup}</main>`);
  source = source.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escape(result.title)}</title>`);
  if (result.description) source = source.replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${escape(result.description)}">`);
  if (id !== undefined) source = source.replace(/<body\b[^>]*>/, () => `<body class="page-${page}" data-page="${page}" data-content-id="${escape(id)}">`);
  if (id !== undefined) source = source.replace('<body ', '<body data-generated-detail="true" ');
  source = source.replace(/((?:src|href)=")(\.\/assets\/(?:js|css)\/[^"?]+)(?:\?v=[^"]*)?"/g, (_, prefix, url) => {
    const version = createHash('sha256').update(fs.readFileSync(path.join(root,url))).digest('hex').slice(0,12);
    return `${prefix}${url}?v=${version}"`;
  });
  const nav = page === 'article' ? 'articles' : page === 'resource' ? 'resources' : page;
  source = source.replace(/( data-nav="[^"]+") aria-current="page"/g, '$1');
  source = source.replace(new RegExp(`data-nav="${nav}"`, 'g'), `$& aria-current="page"`);
  return source;
}
let count = 0;
const details = new Set();
for (const [file, page] of Object.entries({'index.html':'home','articles.html':'articles','resources.html':'resources','about.html':'about','article.html':'article','resource.html':'resource','search.html':'search'})) {
  const target = path.join(root, file);
  const template = fs.readFileSync(target, 'utf8');
  fs.writeFileSync(target, build(template, page));
  count++;
  if (page === 'article' || page === 'resource') {
    const ids = new Set();
    for (const item of data[page === 'article' ? 'articles' : 'resources']) {
      const id = String(item.id);
      if (ids.has(id)) throw new Error(`Duplicate ${page} id: ${id}`);
      ids.add(id);
      // Literal percent escapes in filenames are not portable through URL decoding.
      // Keep established query URLs for IDs that cannot be safely used as filenames.
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) continue;
      const filename = `${page}-${id}.html`;
      details.add(filename);
      fs.writeFileSync(path.join(root, filename), build(template, page, new URLSearchParams({id}), id));
      count++;
    }
  }
}
for (const file of fs.readdirSync(root)) {
  if (/^(article|resource)-[a-zA-Z0-9_-]+\.html$/.test(file) && !details.has(file) && fs.readFileSync(path.join(root,file),'utf8').includes('data-generated-detail="true"')) fs.unlinkSync(path.join(root,file));
}
console.log(`Prerendered ${count} pages.`);
