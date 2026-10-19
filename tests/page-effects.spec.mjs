import { test, expect } from '@playwright/test';
import * as lib from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import { splitPdfPages, outputBudget, MAX_OUTPUT_BYTES } from '../public/js/core/page-split.js';
import { safeOutputName } from '../public/js/core/output-names.js';
import { createOutputZip } from '../public/js/core/output-zip.js';

async function fixture(count=4,{geometry=false,structures=false}={}) {
  const doc=await lib.PDFDocument.create(),font=await doc.embedFont(lib.StandardFonts.Helvetica);doc.setTitle('Decoration source');
  for(let index=0;index<count;index++){const page=doc.addPage([360,300]);page.drawText(`SOURCE_PAGE_${index+1}`,{x:65,y:155,size:12,font});if(geometry){page.setCropBox(20,30,320,240);page.setRotation(lib.degrees(index%4*90));page.node.set(lib.PDFName.of('UserUnit'),lib.PDFNumber.of(index%2?2:1));}}
  if(structures){const field=doc.getForm().createTextField('decorField');field.setText('FORM_KEPT');field.addToPage(doc.getPage(0),{x:70,y:70,width:100,height:20});doc.catalog.set(lib.PDFName.of('Outlines'),doc.context.obj({Type:'Outlines',Count:0}));const uri=doc.context.obj({Type:'Annot',Subtype:'Link',Rect:[60,130,160,145],A:{S:'URI',URI:lib.PDFString.of('https://example.org/keep')}});doc.getPage(0).node.addAnnot(doc.context.register(uri));}
  return new Uint8Array(await doc.save());
}
async function open(page,route,bytes){await page.addInitScript(()=>localStorage.setItem('bpdf-consent','rejected'));await page.goto('/'+route);await page.setInputFiles('#fileInput',{name:'decoration-source.pdf',mimeType:'application/pdf',buffer:Buffer.from(bytes)});await expect(page.locator('#pageEffectsTask')).toBeVisible();await expect(page.locator('#previewCanvas')).toHaveAttribute('data-pdf-page','1');await expect(page.locator(route==='split'?'#splitActionBtn':'#applyBtn')).toBeEnabled();}
async function range(page,value){await page.getByRole('textbox',{name:'Page ranges',exact:true}).fill(value);await page.getByRole('button',{name:'Select range',exact:true}).click();}
async function ready(page){await expect(page.locator('#applyBtn')).toBeEnabled();}
async function download(page,testInfo,name,{build=true}={}){if(build)await page.click('#applyBtn');await expect(page.locator('#documentResultStatus')).toContainText('actual file');const [download]=await Promise.all([page.waitForEvent('download'),page.click('#downloadResultBtn')]);await download.saveAs(testInfo.outputPath(name));return new Uint8Array(await readFile(testInfo.outputPath(name)));}
async function content(page,bytes){return page.evaluate(async(values)=>{const runtime=await import('/js/lib-loader.js'),task=(await runtime.ensurePdfJs()).getDocument({data:new Uint8Array(values),...runtime.PDFJS_ASSET_URLS});try{const doc=await task.promise,out=[];for(let index=1;index<=doc.numPages;index++){const page=await doc.getPage(index),viewport=page.getViewport({scale:1}),text=await page.getTextContent();out.push({width:viewport.width,height:viewport.height,items:text.items.filter((item)=>typeof item.str==='string').map((item)=>({text:item.str,point:viewport.convertToViewportPoint(item.transform[4],item.transform[5])}))});}return out;}finally{await task.destroy();}},Array.from(bytes));}
function unzip(bytes){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),entries=[];let offset=0;while(view.getUint32(offset,true)===0x04034b50){const size=view.getUint32(offset+18,true),length=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true),name=new TextDecoder().decode(bytes.subarray(offset+30,offset+30+length)),start=offset+30+length+extra;entries.push({name,bytes:bytes.slice(start,start+size)});offset=start+size;}return entries;}

async function holdInitialThumbnail(page, source) {
  await page.evaluate(async (values) => {
    const runtime = await import('/js/lib-loader.js'), pdfjs = await runtime.ensurePdfJs();
    const task = pdfjs.getDocument({ data: new Uint8Array(values), ...runtime.PDFJS_ASSET_URLS });
    const doc = await task.promise, prototype = Object.getPrototypeOf(await doc.getPage(1)); await task.destroy();
    const original = prototype.render;
    window.initialThumbnailHeld = false; window.initialThumbnailReserved = false; window.initialThumbnailReleased = false;
    window.initialThumbnailHold = new Promise((resolve) => { window.releaseInitialThumbnail = resolve; });
    window.restoreInitialThumbnail = () => { prototype.render = original; };
    prototype.render = function(options) {
      const rendered = original.call(this, options);
      if (!window.initialThumbnailReserved && options.canvasContext.canvas.closest('#pageSelection')) {
        window.initialThumbnailReserved = true;
        return { cancel: () => rendered.cancel(), promise: rendered.promise.then(async () => {
          window.initialThumbnailHeld = true; await window.initialThumbnailHold; window.initialThumbnailReleased = true;
        }) };
      }
      return rendered;
    };
  }, Array.from(source));
}

async function currentTaskBytes(page) {
  return page.evaluate(async () => {
    const { documentSession } = await import('/js/tool-ui.js');
    return { snapshot: documentSession.snapshot(), current: Array.from(documentSession.current().bytes), original: Array.from(documentSession.original().bytes) };
  });
}

for (const valid of [false, true]) test(`Initial Split hydration ${valid ? 'serializes valid replacement before chosen output continuation' : 'retains its workspace after malformed PDF replacement rejection'}`, async ({ page }, testInfo) => {
  const source = await fixture(3), replacementDoc = await lib.PDFDocument.create(), font = await replacementDoc.embedFont(lib.StandardFonts.Helvetica);
  for (let index = 0; index < 2; index++) {
    const pdfPage = replacementDoc.addPage([420,260]); pdfPage.drawRectangle({ x:0,y:0,width:420,height:260,color:lib.rgb(.1,.2,.8) });
    pdfPage.drawText(`REPLACEMENT_B_PAGE_${index + 1}`, { x:35,y:110,size:14,font,color:lib.rgb(1,1,1) });
  }
  const replacement = new Uint8Array(await replacementDoc.save());
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('bpdf-consent', 'rejected')); await page.goto('/split');
  await holdInitialThumbnail(page, source);
  await chooseNativeFile(page, '#fileInput', { name:'initial-source.pdf',mimeType:'application/pdf',buffer:Buffer.from(source) });
  await expect.poll(() => page.evaluate(() => window.initialThumbnailHeld)).toBe(true);
  const initialSurface = await page.locator('#pageEffectsTask').elementHandle();
  const before = await currentTaskBytes(page); expect(before.current).toEqual(Array.from(source)); expect(before.original).toEqual(Array.from(source));
  await expect(page.locator('#splitActionBtn')).toBeDisabled();
  await chooseNativeFile(page, '#fileInput', { name:valid?'replacement-valid.pdf':'malformed-structure.pdf',mimeType:'application/pdf',buffer:valid?Buffer.from(replacement):Buffer.from('%PDF-1.7\nThis is not a PDF object or cross-reference table.\n%%EOF') });
  if (valid) {
    await expect.poll(async () => (await currentTaskBytes(page)).snapshot.current.name).toBe('replacement-valid.pdf');
    const accepted = await currentTaskBytes(page); expect(accepted.snapshot.taskId).not.toBe(before.snapshot.taskId);
    expect(accepted.current).toEqual(Array.from(replacement)); expect(accepted.original).toEqual(Array.from(replacement));
    expect(await initialSurface.evaluate((surface) => surface.isConnected)).toBe(true);
    await expect(page.locator('#splitActionBtn')).toBeDisabled();
  } else {
    await expect(page.locator('#errorText')).toContainText('Could not open this PDF');
    expect(await currentTaskBytes(page)).toEqual(before);
  }
  await expect(page.locator('#pageEffectsTask')).toHaveCount(1);
  await page.evaluate(() => { window.restoreInitialThumbnail(); window.releaseInitialThumbnail(); });
  await expect.poll(() => page.evaluate(() => window.initialThumbnailReleased)).toBe(true);
  await expect(page.locator('#splitActionBtn')).toBeEnabled(); await expect(page.locator('#previewCanvas')).toHaveAttribute('data-pdf-page','1');
  await expect(page.locator('#pageEffectsTask')).toHaveCount(1); await expect(page.locator('body')).toHaveClass(/page-effects-loaded/);
  await expect(page.locator('#pageEffectsIdentity')).toContainText(valid?'replacement-valid.pdf':'initial-source.pdf');
  const expectedSource = valid ? replacement : source, current = await currentTaskBytes(page);
  expect(current.current).toEqual(Array.from(expectedSource)); expect(current.original).toEqual(Array.from(expectedSource));
  if (!valid) expect(current.snapshot.taskId).toBe(before.snapshot.taskId);
  const preview = await page.locator('#previewCanvas').evaluate((canvas) => canvas.toDataURL());
  await page.click('#splitActionBtn'); const saved = await download(page,testInfo,valid?'replacement-after-initial-hydrate.pdf':'retained-after-rejected-hydrate.pdf',{build:false});
  expect((await lib.PDFDocument.load(saved)).getPageCount()).toBe(valid?2:3);
  expect((await content(page,saved)).map((pdfPage) => pdfPage.items.map((item) => item.text).join(' '))).toEqual(Array.from({length:valid?2:3},(_,index)=>expect.stringContaining(`${valid?'REPLACEMENT_B_PAGE_':'SOURCE_PAGE_'}${index+1}`)));
  expect(await savedPageCanvas(page,saved,1)).toBe(preview);
  await expect(page.locator('#pageOutputGroup')).toHaveCount(1); await expect(page.locator('#documentResult')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/page-effects-loaded/); expect((await currentTaskBytes(page)).current).toEqual(Array.from(expectedSource));
  if (valid) {
    await page.locator('#chainRow').getByRole('button',{name:'Organize',exact:true}).click(); await expect(page).toHaveURL(/organize\?workflow=/);
    await expect(page.locator('#pageTaskIdentity')).toContainText('replacement-valid-extracted.pdf');
    expect((await currentTaskBytes(page)).current).toEqual(Array.from(saved));
  }
  expect(errors).toEqual([]);
});

test('Split lists all 25 named outputs, edits safe unique names, downloads complete ZIP and continues exact chosen PDF',async({page},testInfo)=>{
  const source=await fixture(25,{structures:true});await open(page,'split',source);let downloads=0;page.on('download',()=>downloads++);await page.click('#modeEach');await expect(page.locator('#splitActionBtn')).toBeEnabled();await page.click('#splitActionBtn');await expect(page.locator('#outputListStatus')).toContainText('25 files');expect(downloads).toBe(0);await expect(page.locator('#outputList li')).toHaveCount(12);
  await page.locator('[data-output-name="0"]').fill('chosen.pdf');await page.locator('[data-output-name="0"]').press('Tab');await expect(page.locator('#documentResultIdentity')).toContainText('chosen.pdf');
  await page.locator('[data-output-name="1"]').fill('chosen.pdf');await page.locator('[data-output-name="1"]').press('Tab');await expect(page.locator('[data-output-name="1"]')).toHaveValue('chosen (2).pdf');
  await page.click('#outputNextBtn');await page.click('#outputNextBtn');await expect(page.locator('[data-output-name="24"]')).toBeVisible();await page.locator('[data-output-name="24"]').fill('../final-page.jpg');await page.locator('[data-output-name="24"]').press('Tab');await expect(page.locator('#documentResultIdentity')).toContainText('..-final-page.pdf');await expect(page.locator('#documentResultLosses')).toContainText('interactive form');
  const chosen=await download(page,testInfo,'chosen-page25.pdf',{build:false});expect((await content(page,chosen))[0].items.map((item)=>item.text).join(' ')).toContain('SOURCE_PAGE_25');
  expect(await page.evaluate(async()=>Array.from((await import('/js/tool-ui.js')).documentSession.current().bytes))).toEqual(Array.from(source));
  const [archive]=await Promise.all([page.waitForEvent('download'),page.click('#downloadZipBtn')]);await archive.saveAs(testInfo.outputPath('all25.zip'));const entries=unzip(new Uint8Array(await readFile(testInfo.outputPath('all25.zip'))));expect(entries).toHaveLength(25);expect(entries[0].name).toBe('chosen.pdf');expect(entries[1].name).toBe('chosen (2).pdf');expect(entries[24].bytes).toEqual(chosen);
  await page.locator('#chainRow').getByRole('button',{name:'Organize',exact:true}).click();await expect(page).toHaveURL(/organize\?workflow=/);await expect(page.locator('#pageTaskIdentity')).toContainText('..-final-page.pdf');expect(await page.evaluate(async()=>Array.from((await import('/js/tool-ui.js')).documentSession.current().bytes))).toEqual(Array.from(chosen));
});

test('Split uses shared ranges, parity, Shift and keyboard; selected extraction keeps exact order',async({page},testInfo)=>{await open(page,'split',await fixture(6));await page.locator('[data-selection="odd"]').click();await expect(page.getByRole('textbox',{name:'Page ranges',exact:true})).toHaveValue('1,3,5');await page.locator('[data-page-index="1"]').click();await page.locator('[data-page-index="3"]').click({modifiers:['Shift']});await expect(page.getByRole('textbox',{name:'Page ranges',exact:true})).toHaveValue('2-4');await page.locator('[data-page-index="3"]').focus();await page.keyboard.press('Space');await expect(page.getByRole('textbox',{name:'Page ranges',exact:true})).toHaveValue('2-3');await range(page,'0');await expect(page.locator('.page-workspace-error')).toBeVisible();await range(page,'2,5');await expect(page.locator('#splitActionBtn')).toBeEnabled();await page.click('#splitActionBtn');const bytes=await download(page,testInfo,'selected-extraction.pdf',{build:false});expect((await content(page,bytes)).map((p)=>p.items.map((item)=>item.text).join(' '))).toEqual([expect.stringContaining('SOURCE_PAGE_2'),expect.stringContaining('SOURCE_PAGE_5')]);});

test('Numbers selected scope, start page/number, font and margins save at correct visual coordinates for four rotations/CropBox/UserUnit',async({page},testInfo)=>{
  await open(page,'page-numbers',await fixture(4,{geometry:true,structures:true}));await range(page,'1-4');await page.fill('#numberStartPage','2');await page.fill('#startInput','7');await page.selectOption('#numberFont','bold');await page.fill('#numberSize','14');await page.fill('#numberMarginX','18');await page.fill('#numberMarginY','22');await page.selectOption('#positionSelect','bottom-left');await ready(page);await page.fill('#pagePreviewNumber','4');await page.locator('#pagePreviewNumber').press('Tab');await expect(page.locator('#previewCanvas')).toHaveAttribute('data-pdf-page','4');await ready(page);const preview=await page.locator('#previewCanvas').evaluate((c)=>c.toDataURL());const bytes=await download(page,testInfo,'scoped-numbers.pdf'),pages=await content(page,bytes);expect(pages[0].items.map((item)=>item.text)).not.toContain('7');
  for(let index=1;index<4;index++){const item=pages[index].items.find((item)=>item.text===String(index+6));expect(item).toBeTruthy();expect(item.point[0]).toBeCloseTo(18,2);expect(item.point[1]).toBeCloseTo(pages[index].height-22,2);}
  const doc=await lib.PDFDocument.load(bytes);expect(doc.getForm().getTextField('decorField').getText()).toBe('FORM_KEPT');expect(doc.getTitle()).toBe('Decoration source');expect(doc.catalog.has(lib.PDFName.of('Outlines'))).toBe(true);expect(doc.getPage(0).node.Annots().asArray().some((ref)=>doc.context.lookup(ref).has(lib.PDFName.of('A')))).toBe(true);
  const actual=await page.evaluate(async(values)=>{const runtime=await import('/js/lib-loader.js'),task=(await runtime.ensurePdfJs()).getDocument({data:new Uint8Array(values),...runtime.PDFJS_ASSET_URLS});try{const doc=await task.promise,canvas=document.createElement('canvas');canvas.style.position='fixed';canvas.style.left='-2000px';document.body.append(canvas);await(await import('/js/core/bounded-renderer.js')).renderBoundedPage(await doc.getPage(4),canvas,{maxDimension:1200,maxPixels:2000000});const actual=canvas.toDataURL();canvas.remove();return actual;}finally{await task.destroy();}},Array.from(bytes));expect(actual).toBe(preview);
  await page.click('#useResultBtn');await expect(page.locator('#pageEffectsStatus')).toContainText('Current document');await expect(page.locator('#applyBtn')).toBeDisabled();await page.click('#undoDocumentBtn');await ready(page);
});

test('Watermark preserves Unicode, scope and custom position, rejects unsupported glyphs and exports actual selected preview',async({page},testInfo)=>{await open(page,'watermark',await fixture(4,{geometry:true,structures:true}));await range(page,'2,4');await page.fill('#watermarkText','İpek Şahin Çağrı');await page.selectOption('#styleSelect','horizontal');await page.fill('#watermarkX','35');await page.fill('#watermarkY','30');await page.fill('#sizeSlider','20');await page.fill('#opacitySlider','80');await ready(page);await page.fill('#pagePreviewNumber','2');await page.locator('#pagePreviewNumber').press('Tab');await ready(page);const bytes=await download(page,testInfo,'unicode-watermark.pdf'),pages=await content(page,bytes);for(const index of [0,2])expect(pages[index].items.map((i)=>i.text).join(' ')).not.toContain('İpek');for(const index of [1,3])expect(pages[index].items.map((i)=>i.text).join(' ')).toContain('İpek Şahin Çağrı');expect((await lib.PDFDocument.load(bytes)).getForm().getTextField('decorField').getText()).toBe('FORM_KEPT');await page.fill('#watermarkText','Unsupported 🦄');await expect(page.locator('#errorText')).toContainText('no characters were removed');await expect(page.locator('#applyBtn')).toBeDisabled();await expect(page.locator('#documentResult')).toBeHidden();await page.fill('#watermarkText','DRAFT');await ready(page);});

test('Watermark normalized logo retains alpha, tiles selected pages and enforces aggregate placement budget',async({page},testInfo)=>{const logo=createCanvas(40,20),ctx=logo.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,20,10);ctx.fillStyle='#0000ff';ctx.fillRect(20,0,20,10);await open(page,'watermark',await fixture(2));await range(page,'2');await page.selectOption('#watermarkKind','logo');await page.setInputFiles('#watermarkLogoInput',{name:'alpha-logo.png',mimeType:'image/png',buffer:logo.toBuffer('image/png')});await page.fill('#watermarkLogoWidth','45');await page.check('#watermarkTile');await page.fill('#watermarkRotation','0');await page.fill('#watermarkGap','30');await ready(page);const bytes=await download(page,testInfo,'tiled-logo.pdf'),doc=await lib.PDFDocument.load(bytes);const xobject=(index)=>doc.getPage(index).node.Resources().lookupMaybe(lib.PDFName.of('XObject'),lib.PDFDict);expect(xobject(0)?.keys().length||0).toBe(0);expect(xobject(1).keys().length).toBe(30);expect(new Set(xobject(1).keys().map((key)=>xobject(1).get(key).toString())).size).toBe(1);const image=doc.context.lookup(xobject(1).get(xobject(1).keys()[0]));expect(image.dict.get(lib.PDFName.of('Width')).asNumber()).toBe(40);expect(image.dict.get(lib.PDFName.of('Height')).asNumber()).toBe(20);const rgb=lib.decodePDFRawStream(image).decode(),alpha=lib.decodePDFRawStream(doc.context.lookup(image.dict.get(lib.PDFName.of('SMask')))).decode();expect([...rgb.subarray(0,3)]).toEqual([255,0,0]);expect([...rgb.subarray(20*3,20*3+3)]).toEqual([0,0,255]);expect([...alpha]).toEqual(Array.from({length:800},(_,index)=>index<400?255:0));
  const rejected=await page.evaluate(async()=>{const runtime=await import('/js/lib-loader.js'),core=await import('/js/core/page-effects.js'),pdfLib=await runtime.ensurePdfLib(),source=await pdfLib.PDFDocument.create();source.addPage([100000,100000]);const bytes=new Uint8Array(await source.save());let renders=0;const pdfjs={getDocument:()=>({promise:Promise.resolve({getPage:async()=>({getViewport:()=>({width:100000,height:100000})})}),destroy:async()=>{}})};try{await core.applyPageEffect(bytes,{kind:'watermark',pages:[0],text:'x',size:4,tile:true,gap:10},{pdfLib,pdfjs,embedFont:async(doc)=>doc.embedFont(pdfLib.StandardFonts.Helvetica)});return 'accepted';}catch(error){return error.message;}});expect(rejected).toContain('1,000 stamps per page');});

test('Cancelled Split work cannot publish after replacement and ZIP CRC work honors cancellation',async({page})=>{await open(page,'split',await fixture(25));await page.click('#modeEach');await expect(page.locator('#splitActionBtn')).toBeEnabled();await page.evaluate(async()=>{const runtime=await import('/js/lib-loader.js'),lib=await runtime.ensurePdfLib();window.savedSave=lib.PDFDocument.prototype.save;window.saveHeld=false;window.saveHold=new Promise((resolve)=>window.releaseSave=resolve);lib.PDFDocument.prototype.save=async function(...args){if(!window.saveHeld){window.saveHeld=true;await window.saveHold;}return window.savedSave.apply(this,args);};});await page.click('#splitActionBtn');await expect.poll(()=>page.evaluate(()=>window.saveHeld)).toBe(true);await page.click('#cancelPageEffectBtn');await page.setInputFiles('#fileInput',{name:'fresh.pdf',mimeType:'application/pdf',buffer:Buffer.from(await fixture(2))});await expect(page.locator('#pageEffectsIdentity')).toContainText('fresh.pdf');await page.evaluate(async()=>{const lib=await(await import('/js/lib-loader.js')).ensurePdfLib();lib.PDFDocument.prototype.save=window.savedSave;window.releaseSave();});await expect(page.locator('#splitActionBtn')).toBeEnabled();await expect(page.locator('#pageOutputGroup')).toHaveCount(0);});

test('Output names, aggregate limits, core cancellation and ZIP content are bounded without partial publication',async()=>{const used=new Set();expect(safeOutputName('a.pdf','.pdf',used)).toBe('a.pdf');expect(safeOutputName('A.pdf','.pdf',used)).toBe('A (2).pdf');expect(safeOutputName('CON.png','.pdf')).toBe('_CON.pdf');expect(safeOutputName('a/b\\c.jpg','.pdf')).toBe('a-b-c.pdf');expect(()=>outputBudget([{bytes:{length:MAX_OUTPUT_BYTES+1}}])).toThrow();const source=await fixture(3),before=source.slice(),controller=new AbortController();await expect(splitPdfPages(source,{pages:[0,1,2],each:true},{pdfLib:lib,signal:controller.signal,onProgress:()=>controller.abort()})).rejects.toHaveProperty('name','AbortError');expect(source).toEqual(before);const results=[{name:'a.pdf',bytes:Uint8Array.of(1,2,3)},{name:'b.pdf',bytes:Uint8Array.of(4,5,6)}];expect(unzip(await createOutputZip(results)).map((v)=>v.bytes)).toEqual(results.map((v)=>v.bytes));const cancelled=new AbortController();const promise=createOutputZip([{name:'big.pdf',bytes:new Uint8Array(5*1024*1024)}],{signal:cancelled.signal});cancelled.abort();await expect(promise).rejects.toHaveProperty('name','AbortError');});

for(const [width,theme,route]of[[320,'light','page-numbers'],[390,'dark','watermark'],[768,'light','split'],[1440,'dark','watermark']])test(`Loaded page effects fit ${width}px ${theme} with keyboard and RTL`,async({page})=>{await page.setViewportSize({width,height:900});await page.addInitScript((theme)=>localStorage.setItem('pdf2md-theme',theme),theme);await open(page,route,await fixture(4));await page.evaluate(()=>document.documentElement.dir='rtl');await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.locator('#pageEffectsIdentity')).toBeVisible();await expect(page.locator('#previewCanvas')).toBeVisible();await page.locator('[data-selection="none"]').focus();await page.keyboard.press('Enter');await expect(page.getByRole('textbox',{name:'Page ranges',exact:true})).toHaveValue('');});


test('Cancelled logo normalization cannot resurrect readiness or contaminate a later actual artifact',async({page},testInfo)=>{
  const cancelled=createCanvas(40,20);cancelled.getContext('2d').fillStyle='#f00000';cancelled.getContext('2d').fillRect(0,0,40,20);
  const fresh=createCanvas(60,30);fresh.getContext('2d').fillStyle='#0000f0';fresh.getContext('2d').fillRect(0,0,60,30);
  const source=await fixture(3);await open(page,'watermark',source);await page.selectOption('#watermarkKind','logo');
  await page.evaluate(()=>{const original=File.prototype.arrayBuffer;window.oldLogoRead=original;window.logoHeld=false;window.logoHold=new Promise((resolve)=>window.releaseLogo=resolve);File.prototype.arrayBuffer=async function(...args){if(this.name==='abandoned-logo.png'){window.logoHeld=true;await window.logoHold;}return original.apply(this,args);};});
  await page.setInputFiles('#watermarkLogoInput',{name:'abandoned-logo.png',mimeType:'image/png',buffer:cancelled.toBuffer('image/png')});await expect.poll(()=>page.evaluate(()=>window.logoHeld)).toBe(true);await page.click('#cancelPageEffectBtn');await expect(page.locator('#applyBtn')).toBeDisabled();await expect(page.locator('#retryPageEffectBtn')).toBeVisible();
  await page.evaluate(()=>{File.prototype.arrayBuffer=window.oldLogoRead;window.releaseLogo();});await page.waitForTimeout(300);await expect(page.locator('#applyBtn')).toBeDisabled();await expect(page.locator('#retryPageEffectBtn')).toBeVisible();await expect(page.locator('#documentResult')).toBeHidden();
  await page.setInputFiles('#watermarkLogoInput',{name:'fresh-logo.png',mimeType:'image/png',buffer:fresh.toBuffer('image/png')});await ready(page);const bytes=await download(page,testInfo,'fresh-after-logo-cancel.pdf'),doc=await lib.PDFDocument.load(bytes);
  for(const pdfPage of doc.getPages()){const images=pdfPage.node.Resources().lookup(lib.PDFName.of('XObject'),lib.PDFDict),image=doc.context.lookup(images.get(images.keys()[0]));expect(image.dict.get(lib.PDFName.of('Width')).asNumber()).toBe(60);expect([...lib.decodePDFRawStream(image).decode().subarray(0,3)]).toEqual([0,0,240]);}
  expect(await page.evaluate(async()=>Array.from((await import('/js/tool-ui.js')).documentSession.current().bytes))).toEqual(Array.from(source));
});

test('Natural 320×720 loaded canvas exposes half a page or 35 percent of viewport and full long identity stays accessible',async({page})=>{
  await page.setViewportSize({width:320,height:720});await page.addInitScript(()=>localStorage.setItem('bpdf-consent','rejected'));await page.goto('/page-numbers');const name='Long-document-name-'+('review-'.repeat(18))+'.pdf';await page.setInputFiles('#fileInput',{name,mimeType:'application/pdf',buffer:Buffer.from(await fixture(4))});await expect(page.locator('#previewCanvas')).toHaveAttribute('data-pdf-page','1');await ready(page);
  expect(await page.locator('#pageEffectsIdentity').getAttribute('aria-label')).toContain(name);
  const geometry=await page.evaluate(()=>{const box=document.getElementById('previewCanvas').getBoundingClientRect();return{visible:Math.max(0,Math.min(innerHeight,box.bottom)-Math.max(0,box.top)),required:Math.min(box.height/2,innerHeight*.35),overflow:document.documentElement.scrollWidth-innerWidth,scrollY};});expect(geometry.scrollY).toBe(0);expect(geometry.overflow).toBeLessThanOrEqual(0);expect(geometry.visible).toBeGreaterThanOrEqual(geometry.required);
});


test('Sparse tiled text still stamps every selected page of the actual saved PDF',async({page},testInfo)=>{await open(page,'watermark',await fixture(4,{geometry:true}));await page.fill('#watermarkText','DRAFT');await page.fill('#sizeSlider','56');await page.check('#watermarkTile');await page.fill('#watermarkGap','1000');await ready(page);const bytes=await download(page,testInfo,'sparse-tiles.pdf');for(const pdfPage of await content(page,bytes))expect(pdfPage.items.map((item)=>item.text).join(' ')).toContain('DRAFT');});


async function holdResultPreview(page) {
  await page.evaluate(async () => {
    const ui = await import('/js/tool-ui.js'), runtime = await import('/js/lib-loader.js'), pdfjs = await runtime.ensurePdfJs();
    const task = pdfjs.getDocument({ data: ui.documentSession.current().bytes, ...runtime.PDFJS_ASSET_URLS });
    const doc = await task.promise, proto = Object.getPrototypeOf(await doc.getPage(1)); await task.destroy();
    const original = proto.render; window.firstResultHeld = false; window.firstResultReserved = false; window.resultReleased = false;
    window.resultHold = new Promise((resolve) => { window.releaseResult = resolve; });
    window.restoreResultRender = () => { proto.render = original; };
    proto.render = function(options) {
      const render = original.call(this, options);
      if (!window.firstResultReserved && options.canvasContext.canvas.closest('#documentResultPreview')) {
        window.firstResultReserved = true;
        return { cancel: () => render.cancel(), promise: render.promise.then(async () => { window.firstResultHeld = true; await window.resultHold; window.resultReleased = true; }) };
      }
      return render;
    };
  });
}

async function savedPageCanvas(page, bytes, number) {
  return page.evaluate(async ({ values, number }) => {
    const runtime = await import('/js/lib-loader.js'), task = (await runtime.ensurePdfJs()).getDocument({ data: new Uint8Array(values), ...runtime.PDFJS_ASSET_URLS });
    const canvas = document.createElement('canvas'); canvas.style.position = 'fixed'; canvas.style.left = '-2000px'; document.body.append(canvas);
    try { const doc = await task.promise; await (await import('/js/core/bounded-renderer.js')).renderBoundedPage(await doc.getPage(number), canvas, { maxDimension: 1200, maxPixels: 2000000 }); return canvas.toDataURL(); }
    finally { canvas.remove(); canvas.width = canvas.height = 0; await task.destroy(); }
  }, { values: Array.from(bytes), number });
}

test('Latest accepted page navigation owns the actual saved candidate while an older page render is held', async ({ page }, testInfo) => {
  const doc = await lib.PDFDocument.create(), colors = [[209,31,31],[31,184,46],[31,56,219]];
  for (const color of colors) { const pdfPage = doc.addPage([400,500]); pdfPage.drawRectangle({ x:0,y:0,width:400,height:500,color:lib.rgb(...color.map((n)=>n/255)) }); }
  await open(page, 'page-numbers', new Uint8Array(await doc.save()));
  await page.evaluate(async () => {
    const ui = await import('/js/tool-ui.js'), runtime = await import('/js/lib-loader.js'), pdfjs = await runtime.ensurePdfJs();
    const task = pdfjs.getDocument({ data:ui.documentSession.current().bytes, ...runtime.PDFJS_ASSET_URLS }); const doc = await task.promise, proto = Object.getPrototypeOf(await doc.getPage(1)); await task.destroy();
    const original = proto.render; window.pageTwoHeld = false; window.pageTwoReserved = false; window.pageTwoReleased = false;
    window.pageTwoHold = new Promise((resolve)=>window.releasePageTwo=resolve); window.restorePageRender=()=>{proto.render=original;};
    proto.render=function(options){const render=original.call(this,options);if(this.pageNumber===2&&options.viewport.width>220&&!window.pageTwoReserved){window.pageTwoReserved=true;return{cancel:()=>render.cancel(),promise:render.promise.then(async()=>{window.pageTwoHeld=true;await window.pageTwoHold;window.pageTwoReleased=true;})};}return render;};
  });
  await page.click('#nextPageBtn'); await expect.poll(()=>page.evaluate(()=>window.pageTwoHeld)).toBe(true);
  await expect(page.locator('#applyBtn')).toBeDisabled(); await expect(page.locator('#numberMarginX')).toBeEnabled();
  await page.click('#nextPageBtn'); await expect(page.locator('#pagePreviewNumber')).toHaveValue('3');
  await expect(page.locator('#previewCanvas')).toHaveAttribute('data-pdf-page','3'); await ready(page);
  const bytes=await download(page,testInfo,'latest-page-three.pdf'), actual=await savedPageCanvas(page,bytes,3);
  expect(await page.locator('#previewCanvas').evaluate((canvas)=>canvas.toDataURL())).toBe(actual);
  expect(await page.locator('#previewCanvas').evaluate((canvas)=>Array.from(canvas.getContext('2d').getImageData(10,10,1,1).data))).toEqual([31,56,219,255]);
  await page.evaluate(()=>{window.restorePageRender();window.releasePageTwo();}); await expect.poll(()=>page.evaluate(()=>window.pageTwoReleased)).toBe(true);
  await expect(page.locator('#pagePreviewNumber')).toHaveValue('3'); await expect(page.locator('#pagePreviewStatus')).toHaveText('3 / 3');
  expect(await page.locator('#previewCanvas').evaluate((canvas)=>canvas.toDataURL())).toBe(actual);
});

async function chooseNativeFile(page, selector, file) {
  const input = page.locator(selector);
  await expect(input).toBeEnabled();
  await input.setInputFiles(file);
}

test('Pending replacement logo cannot export the validated predecessor while settings and caret remain editable', async ({ page }, testInfo) => {
  function logo(width,height,color){const image=createCanvas(width,height);image.getContext('2d').fillStyle=color;image.getContext('2d').fillRect(0,0,width,height);return image.toBuffer('image/png');}
  await open(page,'watermark',await fixture(3));await page.selectOption('#watermarkKind','logo');
  await chooseNativeFile(page, '#watermarkLogoInput',{name:'validated-A.png',mimeType:'image/png',buffer:logo(40,20,'#f00000')});await ready(page);await page.click('#applyBtn');await expect(page.locator('#documentResultStatus')).toContainText('actual file');
  await page.evaluate(()=>{const original=File.prototype.arrayBuffer;window.logoSourceRead=original;window.logoSourceHeld=false;window.logoSourceHold=new Promise((resolve)=>window.releaseLogoSource=resolve);File.prototype.arrayBuffer=async function(...args){if(this.name==='pending-B.png'){window.logoSourceHeld=true;await window.logoSourceHold;}return original.apply(this,args);};});
  let downloads=0;page.on('download',()=>downloads++);
  await chooseNativeFile(page, '#watermarkLogoInput',{name:'pending-B.png',mimeType:'image/png',buffer:logo(60,30,'#0000f0')});await expect.poll(()=>page.evaluate(()=>window.logoSourceHeld)).toBe(true);
  await expect(page.locator('#documentResult')).toBeHidden();await expect(page.locator('#chainRow')).toBeHidden();await page.fill('#watermarkLogoWidth','110');await page.fill('#opacitySlider','70');
  const text=page.locator('#watermarkText');await text.fill('İpek');await text.press('End');await page.keyboard.type('!');await expect(text).toHaveValue('İpek!');await expect(text).toBeFocused();
  await expect(page.locator('#pageEffectsStatus')).toContainText('Validating the selected logo');await expect(page.locator('#applyBtn')).toBeDisabled();await page.locator('#applyBtn').dispatchEvent('click');await expect(page.locator('#documentResult')).toBeHidden();expect(downloads).toBe(0);
  await page.evaluate(()=>{File.prototype.arrayBuffer=window.logoSourceRead;window.releaseLogoSource();});await ready(page);await expect(text).toBeFocused();expect(await text.evaluate((input)=>input.selectionStart)).toBe(5);
  const bytes=await download(page,testInfo,'accepted-blue-B.pdf'),saved=await lib.PDFDocument.load(bytes);
  for(const pdfPage of saved.getPages()){const images=pdfPage.node.Resources().lookup(lib.PDFName.of('XObject'),lib.PDFDict);const image=saved.context.lookup(images.get(images.keys()[0]));expect(image.dict.get(lib.PDFName.of('Width')).asNumber()).toBe(60);expect(image.dict.get(lib.PDFName.of('Height')).asNumber()).toBe(30);expect([...lib.decodePDFRawStream(image).decode().subarray(0,3)]).toEqual([0,0,240]);}
  await chooseNativeFile(page, '#watermarkLogoInput',{name:'invalid-draft.png',mimeType:'image/png',buffer:Buffer.from('invalid')});await expect(page.locator('#watermarkLogoStatus')).toContainText('could not be validated');await page.fill('#opacitySlider','50');await expect(page.locator('#applyBtn')).toBeDisabled();await expect(page.locator('#documentResult')).toBeHidden();
  await chooseNativeFile(page, '#fileInput',{name:'rejected-replacement.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a PDF')});await ready(page);await expect(page.locator('#watermarkLogoInput')).toHaveValue('');await expect(page.locator('#watermarkLogoStatus')).toContainText('Validated logo: pending-B.png');
  const recovered=await download(page,testInfo,'validated-B-after-rejected-source.pdf'),reopened=await lib.PDFDocument.load(recovered);for(const pdfPage of reopened.getPages()){const images=pdfPage.node.Resources().lookup(lib.PDFName.of('XObject'),lib.PDFDict),image=reopened.context.lookup(images.get(images.keys()[0]));expect(image.dict.get(lib.PDFName.of('Width')).asNumber()).toBe(60);expect([...lib.decodePDFRawStream(image).decode().subarray(0,3)]).toEqual([0,0,240]);}
});

for(const [route,logoMode]of[['page-numbers',false],['watermark',false],['watermark',true]])test(`Saved ${route} ${logoMode?'logo':'text'} derives searchable capability from actual placements`,async({page},testInfo)=>{
  const source=await lib.PDFDocument.create(),image=createCanvas(20,20);image.getContext('2d').fillStyle='#ddeeef';image.getContext('2d').fillRect(0,0,20,20);const bitmap=await source.embedPng(image.toBuffer('image/png'));for(let index=0;index<3;index++)source.addPage([360,300]).drawImage(bitmap,{x:0,y:0,width:360,height:300});const bytes=new Uint8Array(await source.save());
  await page.addInitScript(()=>localStorage.setItem('bpdf-consent','rejected'));await page.goto('/merge');
  const handoff=await page.evaluate(async({values,route})=>{const ui=await import('/js/tool-ui.js');await ui.ensureDocumentSession();ui.documentSession.begin(new Uint8Array(values),'raster-source.pdf',{capabilities:{searchable:false,rasterized:true,forms:false}});return ui.stashForChain(new Uint8Array(values),'raster-source.pdf',route,{capabilities:{searchable:false,rasterized:true,forms:false}});},{values:Array.from(bytes),route});
  await page.goto(`/${route}?workflow=${encodeURIComponent(handoff.workflowId)}&file=${encodeURIComponent(handoff.fileId)}`);await expect(page.locator('#previewCanvas')).toHaveAttribute('data-pdf-page','1');await ready(page);
  if(logoMode){await page.selectOption('#watermarkKind','logo');await page.setInputFiles('#watermarkLogoInput',{name:'logo.png',mimeType:'image/png',buffer:image.toBuffer('image/png')});await ready(page);}
  const output=await download(page,testInfo,`${route}-${logoMode?'logo':'text'}-capability.pdf`);const glyphs=(await content(page,output)).map((p)=>p.items.map((item)=>item.text).join(' '));
  if(logoMode)expect(glyphs).toEqual(['','','']);else for(const [index,text]of glyphs.entries())expect(text).toContain(route==='page-numbers'?String(index+1):'DRAFT');
  await page.click('#useResultBtn');await expect(page.locator('#pageEffectsStatus')).toContainText('Current document');
  const caps=await page.evaluate(async()=>(await import('/js/tool-ui.js')).documentSession.snapshot().current.capabilities);expect(caps).toMatchObject({searchable:!logoMode,rasterized:true,forms:false,encrypted:false});
  if(route==='page-numbers'){await range(page,'1');await page.fill('#numberStartPage','2');await expect(page.locator('#errorText')).toContainText('within the chosen scope');await expect(page.locator('#applyBtn')).toBeDisabled();await expect(page.locator('#documentResult')).toBeHidden();}
});

test('Panel native window bounds survive actual busy and unlocked page-effect states',async({page})=>{
  await open(page,'split',await fixture(3));const previous=page.getByRole('button',{name:'Previous pages',exact:true}),next=page.getByRole('button',{name:'Next pages',exact:true});await expect(previous).toBeDisabled();await expect(next).toBeDisabled();
  await holdResultPreview(page);await page.click('#modeEach');await expect(page.locator('#splitActionBtn')).toBeEnabled();await page.click('#splitActionBtn');await expect.poll(()=>page.evaluate(()=>window.firstResultHeld)).toBe(true);await expect(previous).toBeDisabled();await expect(next).toBeDisabled();
  await page.click('#cancelPageEffectBtn');await page.click('#retryPageEffectBtn');await expect(page.locator('#splitActionBtn')).toBeEnabled();await expect(previous).toBeDisabled();await expect(next).toBeDisabled();await page.evaluate(()=>{window.restoreResultRender();window.releaseResult();});
});

for(const use of[false,true])test(`Held first Split review ${use?'early Use':'Cancel'} disposes the complete output group before old work resolves`,async({page},testInfo)=>{
  await open(page,'split',await fixture(3));await holdResultPreview(page);await page.click('#modeEach');await expect(page.locator('#splitActionBtn')).toBeEnabled();await page.click('#splitActionBtn');await expect.poll(()=>page.evaluate(()=>window.firstResultHeld)).toBe(true);await expect(page.locator('#pageOutputGroup')).toBeVisible();const abandonedGroup=await page.locator('#pageOutputGroup').elementHandle();
  if(use){await page.click('#useResultBtn');await expect(page.locator('#pageEffectsIdentity')).toContainText('decoration-source-page-1.pdf');}else{await page.click('#cancelPageEffectBtn');await page.click('#retryPageEffectBtn');}
  await expect(page.locator('#pageOutputGroup')).toHaveCount(0);expect(await abandonedGroup.evaluate((node)=>node.childElementCount)).toBe(0);await expect(page.locator('#splitActionBtn')).toBeEnabled();await expect(page.locator('#progressSection')).toBeHidden();
  await page.click('#splitActionBtn');await expect(page.locator('#documentResultStatus')).toContainText('actual file');const fresh=await download(page,testInfo,use?'fresh-after-early-use.pdf':'fresh-before-old-review-release.pdf',{build:false});expect((await lib.PDFDocument.load(fresh)).getPageCount()).toBe(1);expect((await content(page,fresh))[0].items.map((item)=>item.text).join(' ')).toContain('SOURCE_PAGE_1');
  await page.evaluate(()=>{window.restoreResultRender();window.releaseResult();});await expect.poll(()=>page.evaluate(()=>window.resultReleased)).toBe(true);await expect(page.locator('#pageOutputGroup')).toHaveCount(1);await expect(page.locator('#outputListStatus')).toContainText(use?'1 files':'3 files');
});
