import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, PDFDict, PDFName, StandardFonts } from 'pdf-lib';

async function open(page, locale = '') {
  await page.goto(`/${locale ? locale + '/' : ''}view-pdf`);
  if (await page.locator('#consent-reject').isVisible()) await page.locator('#consent-reject').click();
}
async function corpus(page, { many = false, extreme = false } = {}) {
  return page.evaluate(async ({ many, extreme }) => {
    const { ensurePdfLib } = await import(new URL('./lib-loader.js', document.querySelector('script[type=module][src$="js/view-pdf.js"]').src).href);
    const { embedUnicodeFont } = await import(new URL('./core/pdf-fonts.js', document.querySelector('script[type=module][src$="js/view-pdf.js"]').src).href);
    const lib = await ensurePdfLib(), doc = await lib.PDFDocument.create();
    const font = await embedUnicodeFont(doc, { text: 'İstanbul Café READABLE PAGE THIRD Crossspan' });
    const count = many ? 24 : 4, pages = [];
    for (let i = 0; i < count; i++) {
      const page = doc.addPage(extreme ? [50, 14000] : [500, 400]); pages.push(page);
      if (!extreme) { page.setCropBox(30, 25, 420, 330); page.setRotation(lib.degrees([0,90,180,270][i % 4])); page.node.set(lib.PDFName.of('UserUnit'), lib.PDFNumber.of(2)); }
      page.drawText(`İstanbul Café READABLE PAGE ${i + 1}`, { x: extreme ? 1 : 55, y: extreme ? 13500 : 220, size: extreme ? 4 : 14, font });
      if (many) for (let row = 0; row < 4; row++) page.drawText('hit hit hit', { x: 55, y: 190 - row * 20, size: 14, font });
    }
    const destination = doc.context.obj([pages[2].ref, 'Fit']);
    const names = doc.context.obj({ Names: [lib.PDFString.of('reader-third'), destination] });
    doc.catalog.set(lib.PDFName.of('Names'), doc.context.obj({ Dests: names }));
    const outlines = doc.context.obj({ Type: 'Outlines', Count: 2 }); const outlinesRef = doc.context.register(outlines);
    const first = doc.context.obj({ Title: lib.PDFHexString.fromText('İstanbul outline'), Parent: outlinesRef, Dest: [pages[1].ref, 'Fit'] }); const firstRef = doc.context.register(first);
    const second = doc.context.obj({ Title: lib.PDFHexString.fromText('Named third page'), Parent: outlinesRef, Dest: lib.PDFString.of('reader-third'), Prev: firstRef }); const secondRef = doc.context.register(second);
    first.set(lib.PDFName.of('Next'), secondRef); outlines.set(lib.PDFName.of('First'), firstRef); outlines.set(lib.PDFName.of('Last'), secondRef); doc.catalog.set(lib.PDFName.of('Outlines'), outlinesRef);
    pages[0].node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [55, 170, 220, 200], Border: [0,0,0], Dest: lib.PDFString.of('reader-third') })));
    return [...await doc.save()];
  }, { many, extreme });
}
async function load(page, bytes, name = 'Reader meaningful-current-document.pdf') {
  const previousTask = (await state(page)).taskId;
  await page.setInputFiles('#fileInput', { name, mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  await expect.poll(async () => (await state(page)).taskId).not.toBe(previousTask);
  await expect.poll(async () => (await state(page)).current?.name).toBe(name.slice(0, 160));
  await expect(page.locator('#viewerSection')).toBeVisible();
  await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy', 'false');
}
const state = (page) => page.evaluate(async () => {
  const entry = document.querySelector('script[type=module][src$="js/view-pdf.js"]');
  const ui = await import(new URL('./tool-ui.js', entry.src).href); return ui.documentSession.snapshot();
});

test('reader selects original Unicode, searches mapped offsets, navigates outline/named/internal targets and bounded thumbnails', async ({ page }, info) => {
  await open(page); const bytes = await corpus(page); await load(page, bytes);
  const before = await state(page); expect(before.selection).toEqual([0]);
  const select = await page.locator('#readerTextLayer span').first().evaluate((span) => { const range = document.createRange(); range.selectNodeContents(span); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); return selection.toString(); }); expect(select).toContain('İstanbul Café');
  await page.keyboard.press('Shift+ArrowRight'); await expect(page.locator('#pageIndicator')).toHaveText('Page 1 of 4');
  await page.locator('#readerSearch>summary').click(); await page.fill('#readerSearchQuery', 'istanbul cafe'); await page.click('#readerSearchBtn');
  await expect(page.locator('#readerSearchStatus')).toContainText('4 matches'); await expect(page.locator('#readerSearchResults li')).toHaveCount(4);
  await page.locator('#readerSearchResults button').nth(2).click(); await expect(page.locator('#pageIndicator')).toHaveText('Page 3 of 4'); await expect(page.locator('#readerSearchPaint span')).not.toHaveCount(0); expect((await state(page)).selection).toEqual([2]);
  await page.locator('#readerOutline>summary').click(); await expect(page.locator('#readerOutlineItems button')).toHaveCount(2);
  await page.locator('#readerOutlineItems button').first().click(); await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 4');
  await page.locator('#readerOutlineItems button').nth(1).click(); await expect(page.locator('#pageIndicator')).toHaveText('Page 3 of 4');
  await page.fill('#readerPage', '1'); await page.locator('#readerPage').press('Tab'); await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy', 'false');
  await page.locator('#readerLinkLayer button').click(); await expect(page.locator('#pageIndicator')).toHaveText('Page 3 of 4');
  await page.locator('#readerThumbnails>summary').click(); await expect(page.locator('#readerThumbnailItems canvas')).toHaveCount(4);
  const bounds = await page.locator('#readerThumbnailItems canvas').evaluateAll((nodes) => nodes.map((node) => [node.width, node.height])); for (const [w,h] of bounds) { expect(Math.max(w,h)).toBeLessThanOrEqual(220); expect(w*h).toBeLessThanOrEqual(100000); }
  await page.locator('#readerThumbnailItems button').last().click(); await expect(page.locator('#pageIndicator')).toHaveText('Page 4 of 4');
  const after = await state(page); expect(after.taskId).toBe(before.taskId); expect(after.revision).toBe(before.revision); expect(after.selection).toEqual([3]);
  await writeFile(info.outputPath('reader-original.pdf'), Buffer.from(bytes)); await info.attach('reader-state', { body: JSON.stringify({before,after,bounds}), contentType: 'application/json' });
});

test('reader text geometry agrees with actual canvas ink under four rotations, CropBox, UserUnit and zoom', async ({ page }, info) => {
  await open(page); await load(page, await corpus(page)); const records = [];
  for (let i = 0; i < 4; i++) {
    await page.fill('#readerPage', String(i + 1)); await page.locator('#readerPage').press('Tab'); await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy', 'false');
    for (const zoomed of [false, true]) {
      if (zoomed) { await page.click('#zoomInBtn'); await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy', 'false'); }
      const record = await page.evaluate(() => {
        const canvas = document.getElementById('pdfCanvas'), span = document.querySelector('#readerTextLayer span'), range = document.createRange(); range.selectNodeContents(span); const a = range.getBoundingClientRect(), b = canvas.getBoundingClientRect();
        const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data; let all = 0, inside = 0;
        for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) { const at = (y*canvas.width+x)*4; if (pixels[at]<130 && pixels[at+1]<130 && pixels[at+2]<130) { all++; if (x>=(a.left-b.left)*canvas.width/b.width-2 && x<=(a.right-b.left)*canvas.width/b.width+2 && y>=(a.top-b.top)*canvas.height/b.height-2 && y<=(a.bottom-b.top)*canvas.height/b.height+2) inside++; } }
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        return { all, inside, fraction:inside/all, width:canvas.width,height:canvas.height,cssWidth:b.width,cssHeight:b.height,text:selection.toString(),bounds:[a.left-b.left,a.top-b.top,a.width,a.height] };
      });
      records.push({page:i+1,zoomed,...record}); expect(record.all).toBeGreaterThan(100); expect(record.fraction).toBeGreaterThan(.97); expect(record.cssWidth).toBeGreaterThanOrEqual(record.width); expect(record.cssHeight).toBeGreaterThanOrEqual(record.height); expect(record.text).toContain('İstanbul Café'); expect(Math.max(record.width,record.height)).toBeLessThanOrEqual(1200); expect(record.width*record.height).toBeLessThanOrEqual(2000000);
      if (zoomed) { await page.click('#fitWidthBtn'); await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy', 'false'); }
    }
  }
  await info.attach('actual-ink-text-layer-oracles', { body: JSON.stringify(records), contentType:'application/json' });
});

for (const width of [320,390,768,1440]) test(`loaded reader fits ${width}px in light and Arabic RTL dark with visible page`, async ({ page }, info) => {
  await page.setViewportSize({width,height:width<500?720:900});
  for (const [locale,theme] of [['','light'],['ar','dark']]) {
    await open(page,locale); await page.evaluate((theme)=>document.documentElement.dataset.theme=theme,theme); await load(page,await corpus(page),`Current-${'meaningful-document-'.repeat(8)}.pdf`);
    const layout = await page.evaluate(()=>{ const rect=document.getElementById('pdfCanvas').getBoundingClientRect(),scroll=document.getElementById('viewerContainer'); return { width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,y:rect.y,height:rect.height,visible:Math.max(0,Math.min(innerHeight,rect.bottom)-Math.max(0,rect.top)),viewport:innerHeight,surface:scroll.clientWidth,surfaceScroll:scroll.scrollWidth,dir:document.documentElement.dir }; });
    expect(layout.scroll).toBeLessThanOrEqual(width); expect(layout.surfaceScroll).toBeLessThanOrEqual(layout.surface+1); expect(layout.visible).toBeGreaterThanOrEqual(Math.min(layout.viewport*.35,layout.height/2));
    await page.locator('#readerSearch>summary').click(); await page.fill('#readerSearchQuery','istanbul'); await page.locator('#readerSearchQuery').press('Home'); await page.locator('#readerSearchQuery').press('ArrowRight'); const caret=await page.locator('#readerSearchQuery').evaluate((node)=>({node:window.readerCaretNode=node,start:node.selectionStart,end:node.selectionEnd}));
    await page.evaluate(()=>document.getElementById('zoomInBtn').click()); await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy','false');
    expect(await page.locator('#readerSearchQuery').evaluate((node)=>({same:node===window.readerCaretNode,start:node.selectionStart,end:node.selectionEnd}))).toEqual({same:true,start:caret.start,end:caret.end}); await expect(page.locator('#readerSearchQuery')).toBeFocused();
    await info.attach(`${width}-${locale||'en'}-layout`,{body:JSON.stringify(layout),contentType:'application/json'}); await page.screenshot({path:info.outputPath(`${width}-${locale||'en'}-${theme}.png`)});
  }
});

test('reader search discloses result limits, cancels outstanding text streams and bounds extreme page canvases', async ({ page }, info) => {
  await open(page); await load(page, await corpus(page,{many:true})); await page.locator('#readerSearch>summary').click(); await page.fill('#readerSearchQuery','hit'); await page.click('#readerSearchBtn');
  await expect(page.locator('#readerSearchResults li')).toHaveCount(200); await expect(page.locator('#readerSearchStatus')).toContainText('First 200');
  await page.evaluate(async () => {
    const {ensurePdfJs}=await import('/js/lib-loader.js'),pdfjs=await ensurePdfJs();
    // Obtain the public page proxy prototype from an independent local document.
    const {ensurePdfLib}=await import('/js/lib-loader.js'),lib=await ensurePdfLib(),doc=await lib.PDFDocument.create();doc.addPage();const task=pdfjs.getDocument({data:await doc.save()}),pdf=await task.promise,p=await pdf.getPage(1),proto=Object.getPrototypeOf(p),original=proto.streamTextContent;
    window.restoreReaderStream=()=>{proto.streamTextContent=original;void task.destroy();};window.readerCanceled=0;window.readerHeld=false;
    proto.streamTextContent=function(...args){if(this.pageNumber===20){window.readerHeld=true;return new ReadableStream({cancel(){window.readerCanceled++;}});}return original.apply(this,args);};
  });
  await page.fill('#readerSearchQuery','no-such-needle'); await page.click('#readerSearchBtn'); await expect.poll(()=>page.evaluate(()=>window.readerHeld)).toBe(true); await page.click('#readerCancelSearchBtn');
  await expect(page.locator('#readerSearchStatus')).toContainText('canceled'); expect(await page.evaluate(()=>window.readerCanceled)).toBe(1); await page.evaluate(()=>window.restoreReaderStream());
  await page.locator('#readerReplace>summary').click(); await load(page,await corpus(page,{extreme:true}),'extreme-reader.pdf');
  const bounds=await page.locator('#pdfCanvas').evaluate(node=>[node.width,node.height]);expect(bounds[1]/bounds[0]).toBeGreaterThan(200);expect(Math.max(...bounds)).toBeLessThanOrEqual(1200);expect(bounds[0]*bounds[1]).toBeLessThanOrEqual(2000000);await info.attach('extreme-reader-bounds',{body:JSON.stringify(bounds),contentType:'application/json'});
});
test('implicit mode baking propagates searchable text and actual flattened form capability without duplicate edits', async ({page}, info) => {
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),p=doc.addPage([612,792]);p.drawText('ORIGINAL TEXT RETAINED',{x:50,y:700,font,size:14});const field=doc.getForm().createTextField('name');field.addToPage(p,{x:50,y:600,width:300,height:30,font});field.setText('Original');
  await page.goto('/add-text');if(await page.locator('#consent-reject').isVisible())await page.locator('#consent-reject').click();await page.setInputFiles('#fileInput',{name:'capability-source.pdf',mimeType:'application/pdf',buffer:Buffer.from(await doc.save())});await expect(page.locator('#placementCanvas')).toHaveAttribute('aria-busy','false');
  await page.fill('#textInput','IMPLICIT SEARCHABLE STAMP');await page.click('#placeDraftBtn');await expect(page.locator('#objectList option')).toHaveCount(1);await page.locator('#workspaceModes').getByRole('button',{name:'Fill & Sign',exact:true}).click();await expect(page).toHaveURL(/\/fill-sign\?workflow=/);await expect(page.locator('#placementCanvas')).toHaveAttribute('aria-busy','false');
  const read=()=>page.evaluate(async()=>{const entry=document.querySelector('script[type=module][src$="js/fill-sign.js"]')||document.querySelector('script[type=module][src$="js/view-pdf.js"]');const ui=await import(new URL('./tool-ui.js',entry.src).href);return ui.documentSession.snapshot();});
  const inherited=await read();expect(inherited.current.capabilities).toMatchObject({searchable:true,forms:true,encrypted:false});
  await page.fill('.scene-widgets input[data-field=name]','Flattened survivor');await page.check('#flattenInput');await page.locator('.scene-more-modes>summary').click();await page.locator('#workspaceModes button[data-mode=view-pdf]').click();await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy','false');
  const flattened=await read();expect(flattened.taskId).toBe(inherited.taskId);expect(flattened.current.capabilities).toMatchObject({searchable:true,forms:false,encrypted:false});
  const saved=await page.evaluate(async()=>{const entry=document.querySelector('script[type=module][src$="js/view-pdf.js"]'),ui=await import(new URL('./tool-ui.js',entry.src).href),runtime=await import(new URL('./lib-loader.js',entry.src).href),pdfjs=await runtime.ensurePdfJs(),value=await ui.getWorkspaceInput(),task=pdfjs.getDocument({data:value.bytes.slice(),...runtime.PDFJS_ASSET_URLS});try{const pdf=await task.promise,text=(await(await pdf.getPage(1)).getTextContent()).items.map(x=>x.str).join(' ');return{bytes:[...value.bytes],text,capabilities:value.capabilities};}finally{await task.destroy();}});
  await writeFile(info.outputPath('implicit-baked-flattened.pdf'),Buffer.from(saved.bytes));expect(saved.text).toContain('ORIGINAL TEXT RETAINED');expect(saved.text).toContain('Flattened survivor');expect(saved.text.match(/IMPLICIT SEARCHABLE STAMP/g)).toHaveLength(1);expect((await PDFDocument.load(Uint8Array.from(saved.bytes))).getForm().getFields()).toHaveLength(0);

  // Establish a deliberate baked-artifact boundary. The chosen input's known
  // searchability is grounded in reopened embedded text, then its next scene
  // contains only an image: searchable:true cannot be re-derived from text objects.
  const boundary = await page.evaluate(async () => {
    const ui=await import('/js/tool-ui.js'),runtime=await import('/js/lib-loader.js'),lib=await runtime.ensurePdfLib(),input=await ui.getWorkspaceInput();
    const document=await lib.PDFDocument.load(input.bytes.slice(),{updateMetadata:false});document.setTitle('Known searchable baked input');const bytes=await document.save({updateFieldAppearances:false});
    const pdfjs=await runtime.ensurePdfJs(),task=pdfjs.getDocument({data:bytes.slice(),...runtime.PDFJS_ASSET_URLS});let text;
    try{const pdf=await task.promise;text=(await(await pdf.getPage(1)).getTextContent()).items.map(item=>item.str).join(' ');}finally{await task.destroy();}
    if(!text.includes('IMPLICIT SEARCHABLE STAMP'))throw new Error('Known-searchable boundary did not retain its actual embedded text.');
    await ui.reviewResult(bytes,'known-searchable-base.pdf',{capabilities:{...input.capabilities,searchable:true},boundary:{kind:'pdf-rewrite',losses:['scene-baked']}});return{text};
  });
  await expect(page.locator('#documentResultStatus')).toContainText('actual file');await page.click('#useResultBtn');
  expect(await page.evaluate(async()=>(await import('/js/tool-ui.js')).documentSession.scene())).toBeNull();
  await page.locator('#readerModes>summary').click();await page.locator('#workspaceModes button[data-mode=add-image]').click();await expect(page).toHaveURL(/\/add-image\?workflow=/);await expect(page.locator('#previewCanvas')).toHaveAttribute('aria-busy','false');
  const {createCanvas}=await import('@napi-rs/canvas'),image=createCanvas(64,32),context=image.getContext('2d');context.fillStyle='#285fc4';context.fillRect(0,0,64,32);
  await page.selectOption('#pageSelect','1');await page.setInputFiles('#imageInput',{name:'searchable-image-only.png',mimeType:'image/png',buffer:image.toBuffer('image/png')});await expect(page.locator('#objectList option')).toHaveCount(1);
  const imageOnlyBefore=await page.evaluate(async()=>{const ui=await import('/js/tool-ui.js');return{kinds:ui.documentSession.scene().objects.map(object=>object.kind),caps:ui.documentSession.snapshot().current.capabilities};});expect(imageOnlyBefore.kinds).toEqual(['image']);expect(imageOnlyBefore.caps.searchable).toBe(true);
  await page.locator('#workspaceModes').getByRole('button',{name:'Fill & Sign',exact:true}).click();await expect(page).toHaveURL(/\/fill-sign\?workflow=/);await expect(page.locator('#placementCanvas')).toHaveAttribute('aria-busy','false');
  const imageOnlyAfter=await page.evaluate(async()=>{const ui=await import('/js/tool-ui.js');return{kinds:ui.documentSession.scene().objects.map(object=>object.kind),caps:ui.documentSession.snapshot().current.capabilities};});expect(imageOnlyAfter.kinds).toEqual(['image']);expect(imageOnlyAfter.caps).toMatchObject({searchable:true,forms:false,encrypted:false});
  await page.click('#applyBtn');await expect(page.locator('#documentResultStatus')).toContainText('actual file');const[download]=await Promise.all([page.waitForEvent('download'),page.click('#downloadResultBtn')]);const imageFile=info.outputPath('image-only-known-searchable.pdf');await download.saveAs(imageFile);const imageBytes=await readFile(imageFile),imageDoc=await PDFDocument.load(imageBytes),resources=imageDoc.getPage(0).node.Resources().lookup(PDFName.of('XObject'),PDFDict);
  expect(resources.keys().map(key=>imageDoc.context.lookup(resources.get(key))).filter(object=>object.dict?.get(PDFName.of('Subtype'))?.toString()==='/Image')).toHaveLength(1);
  const imageText=await page.evaluate(async(values)=>{const runtime=await import('/js/lib-loader.js'),pdfjs=await runtime.ensurePdfJs(),task=pdfjs.getDocument({data:Uint8Array.from(values),...runtime.PDFJS_ASSET_URLS});try{const pdf=await task.promise;return(await(await pdf.getPage(1)).getTextContent()).items.map(item=>item.str).join(' ');}finally{await task.destroy();}},[...imageBytes]);
  expect(imageText).toContain('ORIGINAL TEXT RETAINED');expect(imageText).toContain('Flattened survivor');expect(imageText.match(/IMPLICIT SEARCHABLE STAMP/g)).toHaveLength(1);await info.attach('actual-image-only-capability-preservation',{body:JSON.stringify({boundary,imageOnlyBefore,imageOnlyAfter,imageText}),contentType:'application/json'});
});

test('owned inherited scene larger than 80MiB survives an actual mode handoff; fresh oversized input rolls back', async ({page},info)=>{
  test.setTimeout(240000);
  const {createCanvas}=await import('@napi-rs/canvas'),canvas=createCanvas(1024,1024),ctx=canvas.getContext('2d'),pixels=ctx.createImageData(1024,1024);let seed=12345;for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i]=seed>>>24;seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i+1]=seed>>>24;seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i+2]=seed>>>24;pixels.data[i+3]=255;}ctx.putImageData(pixels,0,0);
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);doc.addPage([612,792]).drawText('LARGE IMMUTABLE SCENE SOURCE',{x:50,y:700,font,size:14});doc.context.register(doc.context.stream(new Uint8Array(79*1024*1024)));const bytes=await doc.save({useObjectStreams:false});expect(bytes.length).toBeLessThanOrEqual(80*1024*1024);
  await page.goto('/add-image');if(await page.locator('#consent-reject').isVisible())await page.locator('#consent-reject').click();await writeFile(info.outputPath('large-owned-source.pdf'),Buffer.from(bytes));await page.setInputFiles('#fileInput',info.outputPath('large-owned-source.pdf'));await expect(page.locator('#previewCanvas')).toHaveAttribute('aria-busy','false',{timeout:90000});await page.setInputFiles('#imageInput',{name:'large-noise.png',mimeType:'image/png',buffer:canvas.toBuffer('image/png')});await expect(page.locator('#objectList option')).toHaveCount(1);await expect(page.locator('#previewCanvas')).toHaveAttribute('aria-busy','false',{timeout:90000});
  await page.click('#applyBtn');await expect(page.locator('#documentResultStatus')).toContainText('actual file',{timeout:90000});const[download]=await Promise.all([page.waitForEvent('download'),page.click('#downloadResultBtn')]);const file=info.outputPath('large-inherited-scene.pdf');await download.saveAs(file);const output=await readFile(file);expect(output.length).toBeGreaterThan(80*1024*1024);expect((await PDFDocument.load(output)).getPageCount()).toBe(1);
  const before=await page.evaluate(async()=>{const ui=await import('/js/tool-ui.js');return ui.documentSession.snapshot();});await page.locator('#workspaceModes').getByRole('button',{name:'Fill & Sign',exact:true}).click();await expect(page.locator('#placementCanvas')).toHaveAttribute('aria-busy','false',{timeout:90000});await expect(page.locator('#objectList option')).toHaveCount(1);
  const after=await page.evaluate(async()=>{const ui=await import('/js/tool-ui.js'),snapshot=ui.documentSession.snapshot(),scene=ui.documentSession.scene(),source=ui.documentSession.resource(scene.sourceRef);return{snapshot,sourceBytes:source.bytes.length,asset:scene.objects[0].assetId};});expect(after.snapshot.taskId).toBe(before.taskId);expect(after.snapshot.current.size).toBeGreaterThan(80*1024*1024);expect(after.sourceBytes).toBeLessThanOrEqual(80*1024*1024);expect(after.snapshot.resourceBytes).toBeLessThanOrEqual(96*1024*1024);expect(after.snapshot.retainedBytes).toBeLessThanOrEqual(512*1024*1024);expect(after.asset).toMatch(/^asset-/);
  await page.setInputFiles('#fileInput',file);await expect(page.locator('#errorSection')).toContainText('80 MB');const rejected=await page.evaluate(async()=>{const ui=await import('/js/tool-ui.js');return ui.documentSession.snapshot();});expect(rejected).toEqual(after.snapshot);await expect(page.locator('#objectList option')).toHaveCount(1);await info.attach('large-owned-scene-contract',{body:JSON.stringify({before,after,rejected}),contentType:'application/json'});
});
test('visible Reader replacement chooser survives second and third valid intake, rejecting malformed replacement transactionally', async ({ page }, info) => {
  const file = async (text) => { const doc = await PDFDocument.create(); for (let i=0;i<3;i++) doc.addPage([500,400]).drawText(`${text} PAGE ${i+1}`,{x:50,y:250,size:14}); return {name:`${text}.pdf`,mimeType:'application/pdf',buffer:Buffer.from(await doc.save())}; };
  await open(page); await page.setInputFiles('#fileInput',await file('FIRST CURRENT')); await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy','false');
  async function choose(value) { await page.locator('#readerReplace>summary').click(); const[chooser]=await Promise.all([page.waitForEvent('filechooser'),page.click('#dropzone')]); await chooser.setFiles(value); }
  await choose(await file('SECOND CURRENT')); await expect(page.locator('#readerTextLayer')).toContainText('SECOND CURRENT'); await expect(page.locator('#readerTextLayer')).not.toContainText('FIRST CURRENT'); await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy','false');
  const before=await state(page); await choose({name:'malformed.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nmalformed')}); await expect(page.locator('#errorSection')).toBeVisible(); expect(await state(page)).toEqual(before); await expect(page.locator('#readerTextLayer')).toContainText('SECOND CURRENT'); await expect(page.locator('#readerReplace')).toHaveAttribute('open','');
  const[chooser]=await Promise.all([page.waitForEvent('filechooser'),page.click('#dropzone')]);await chooser.setFiles(await file('THIRD CURRENT'));await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy','false');await expect(page.locator('#readerTextLayer')).toContainText('THIRD CURRENT');await expect(page.locator('#readerTextLayer')).not.toContainText('SECOND CURRENT');
  for(const id of ['viewerSection','readerTools','workspaceModes','readerSearch','readerTextLayer','fileInput','pdfCanvas'])await expect(page.locator(`#${id}`)).toHaveCount(1);
  await page.click('#nextPageBtn');await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy','false');await expect(page.locator('#pageIndicator')).toHaveText('Page 2 of 3');await expect(page.locator('#readerTextLayer')).toContainText('THIRD CURRENT PAGE 2');expect((await state(page)).taskId).not.toBe(before.taskId);await page.screenshot({path:info.outputPath('third-reader-replacement.png')});
});

test('reader CSS zoom grows 25/100/125/400 while bitmap, text, links and fit stay aligned', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica), input = doc.addPage([612, 792]);
  input.drawText('ZOOM GEOMETRY RETAINED', { x: 64, y: 650, size: 18, font });
  input.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [64, 600, 264, 625], Border: [0, 0, 0], Dest: [input.ref, 'Fit'] })));
  await load(page, await doc.save(), 'bounded-letter-zoom.pdf');
  async function clickZoom(id, count = 1) {
    for (let i = 0; i < count; i++) {
      await page.click(`#${id}`);
      await expect(page.locator('#viewerSection')).toHaveAttribute('aria-busy', 'false');
    }
  }
  async function capture(percent) {
    await expect(page.locator('#zoomLevel')).toHaveText(`${percent}%`);
    await expect(page.locator('#readerLinkLayer button')).toHaveCount(1);
    const record = await page.evaluate(() => {
      const canvas = document.getElementById('pdfCanvas'), surface = document.getElementById('readerPageSurface'), layer = document.getElementById('readerTextLayer'), link = document.querySelector('#readerLinkLayer button'), container = document.getElementById('viewerContainer');
      const range = document.createRange(); range.selectNodeContents(layer.querySelector('span'));
      const rect = range.getBoundingClientRect(), image = canvas.getBoundingClientRect(), page = surface.getBoundingClientRect(), text = layer.getBoundingClientRect(), destination = link.getBoundingClientRect();
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const nativeRect = [(rect.left-image.left)*canvas.width/image.width, (rect.top-image.top)*canvas.height/image.height, (rect.right-image.left)*canvas.width/image.width, (rect.bottom-image.top)*canvas.height/image.height];
      let ink = 0, inside = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const at = (y * canvas.width + x) * 4;
        if (pixels[at] < 130 && pixels[at+1] < 130 && pixels[at+2] < 130) { ink++; if (x >= nativeRect[0]-2 && x <= nativeRect[2]+2 && y >= nativeRect[1]-2 && y <= nativeRect[3]+2) inside++; }
      }
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      return { nativeWidth: canvas.width, nativeHeight: canvas.height, cssWidth: image.width, cssHeight: image.height, surface: [page.width,page.height], textLayer: [text.width,text.height], selectedText: selection.toString(), ink, fraction: inside/ink, textBox: [rect.left-image.left,rect.top-image.top,rect.width,rect.height], link: [destination.left-page.left,destination.top-page.top,destination.width,destination.height], bodyWidth: document.documentElement.clientWidth, bodyScroll: document.documentElement.scrollWidth, containerWidth:container.clientWidth, containerScroll:container.scrollWidth };
    });
    expect(record.selectedText).toBe('ZOOM GEOMETRY RETAINED'); expect(record.ink).toBeGreaterThan(100); expect(record.fraction).toBeGreaterThan(.97);
    expect(Math.max(record.nativeWidth, record.nativeHeight)).toBeLessThanOrEqual(1200); expect(record.nativeWidth*record.nativeHeight).toBeLessThanOrEqual(2000000);
    expect(record.surface).toEqual([record.cssWidth,record.cssHeight]); expect(record.textLayer).toEqual([record.cssWidth,record.cssHeight]); expect(record.bodyScroll).toBeLessThanOrEqual(record.bodyWidth);
    return { percent, ...record };
  }
  await clickZoom('zoomOutBtn', 3); const quarter = await capture(25);
  await clickZoom('fitWidthBtn'); const fit = await capture(100);
  await clickZoom('zoomInBtn'); const enlarged = await capture(125);
  await clickZoom('zoomInBtn', 11); const maximum = await capture(400);
  await clickZoom('zoomOutBtn'); const smaller = await capture(375);
  await clickZoom('fitWidthBtn'); const restored = await capture(100);
  for (const record of [quarter,enlarged,maximum,smaller]) {
    const multiplier = record.percent/100;
    // CSS page dimensions use the same explicit whole-pixel round-down as
    // TextLayer. Preserve those exact rounding bounds across magnifications.
    expect(record.cssWidth).toBeGreaterThanOrEqual(Math.floor(fit.cssWidth*multiplier)); expect(record.cssWidth).toBeLessThanOrEqual(Math.floor((fit.cssWidth+1)*multiplier));
    expect(record.cssHeight).toBeGreaterThanOrEqual(Math.floor(fit.cssHeight*multiplier)); expect(record.cssHeight).toBeLessThanOrEqual(Math.floor((fit.cssHeight+1)*multiplier));
    for (let i=0;i<4;i++) expect(record.link[i]/multiplier).toBeCloseTo(fit.link[i], 1);
  }
  expect(quarter.cssWidth).toBeLessThan(fit.cssWidth); expect(enlarged.cssWidth).toBeGreaterThan(fit.cssWidth); expect(maximum.cssWidth).toBeGreaterThan(enlarged.cssWidth); expect(smaller.cssWidth).toBeLessThan(maximum.cssWidth);
  expect(fit.nativeHeight).toBe(1200); expect(enlarged.nativeHeight).toBe(1200); expect(maximum.nativeHeight).toBe(1200);
  expect(maximum.containerScroll).toBeGreaterThan(maximum.containerWidth); expect(restored.cssWidth).toBe(fit.cssWidth); expect(restored.cssHeight).toBe(fit.cssHeight); expect(restored.containerScroll).toBeLessThanOrEqual(restored.containerWidth+1);
  await info.attach('logical-css-zoom-and-bounded-native-oracles', { body: JSON.stringify({quarter,fit,enlarged,maximum,smaller,restored}), contentType: 'application/json' });
  await page.screenshot({path:info.outputPath('reader-restored-fit.png')});
});
