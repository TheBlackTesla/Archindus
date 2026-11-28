// Run against the local production worker on CI. Only synthetic sample documents enter this browser context.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {PDFDocument} from 'pdf-lib';

const origin='http://127.0.0.1:4173';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const context=await browser.newContext();
  const external=[], uploads=[];
  context.on('request', request=>{
    const url=new URL(request.url());
    if (url.protocol==='http:'||url.protocol==='https:') {
      if (url.origin!==origin) external.push(url.href);
      if (request.method()!=='GET' && request.method()!=='HEAD') uploads.push(url.pathname);
    }
  });
  const page=await context.newPage();
  page.setDefaultTimeout(25_000);
  page.on('pageerror', error=>console.error(error.message));
  await page.goto(origin+'/workspace');
  const input=page.getByLabel('Add source files');
  const file=async name=>({name,mimeType:'application/pdf',buffer:await readFile('public/examples/'+name)});
  const [regular,scan]=await Promise.all([file('proposal-a.pdf'),file('proposal-b-scan.pdf')]);
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),input.click()]);
  await chooser.setFiles([regular,{name:'empty.txt',mimeType:'text/plain',buffer:Buffer.alloc(0)},scan]);
  await page.getByText(/Added 2 sources.*empty\.txt/).waitFor();
  await page.getByLabel('Question for your documents').fill('Which proposal delivers sooner?');
  await page.getByRole('button',{name:'Build cited brief'}).click();
  const result=page.locator('.work-result');
  assert.match(await result.innerText(),/incomplete/);
  await page.getByRole('button',{name:'Review scans in proposal-b-scan.pdf'}).click();
  const draft=page.getByLabel('Page transcription');
  const read=page.getByRole('button',{name:'Read English text on this device'});
  const apply=page.getByRole('button',{name:'Use reviewed text'});
  const next=page.getByLabel('Scanned page',{exact:true});
  for (const number of [1,2]) {
    await next.selectOption(String(number));
    await read.click();
    await page.waitForFunction(()=>document.querySelector('.work-scan textarea')?.value.trim().length>0,null,{timeout:125_000});
    assert.match(await result.innerText(),/incomplete/);
    const text=await draft.inputValue();
    assert.match(text,number===1?/pilot/i:/23\s+calendar\s+days/i);
    await apply.click();
  }
  await page.getByText(/6 days sooner/).first().waitFor();
  const cite=page.getByRole('button',{name:/proposal-b-scan\.pdf, Page 2 · reviewed transcription/}).first();
  await cite.click();
  assert.match(await page.getByRole('link',{name:'Open original PDF at page 2'}).last().getAttribute('href'),/#page=2$/);
  await draft.fill((await draft.inputValue()).replace('23 calendar','25 calendar'));
  await apply.click();
  await page.getByText(/8 days sooner/).first().waitFor();
  await page.getByRole('button',{name:'Remove reviewed text'}).click();
  assert.match(await result.innerText(),/incomplete/);
  assert.deepEqual(external,[]);
  assert.deepEqual(uploads,[]);
  // The upload path must also detect actual out-of-order and conflicting selectable pages.
  const makePdf=async lines=>{
    const pdf=await PDFDocument.create();
    for (const linesOnPage of lines) {
      const p=pdf.addPage();linesOnPage.forEach((text,i)=>p.drawText(text,{x:40,y:700-i*40,size:13}));
    }
    return {name:'alternate.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())};
  };
  for (const [pages,expect] of [
    [[['We will deliver the pilot within 23 calendar days of written authorization.','Page 2 of 3']],/missing or out-of-order/],
    [[['We will deliver the pilot within 23 calendar days of written authorization.'],['We will deliver the pilot within 31 calendar days of written authorization.']],/terms conflict/],
  ]) {
    page.once('dialog',dialog=>dialog.accept());
    await page.getByRole('button',{name:'New project'}).click();
    await input.setInputFiles([regular,await makePdf(pages)]);
    await page.getByText('Added 2 sources.').waitFor();
    await page.getByLabel('Question for your documents').fill('Which proposal delivers sooner?');
    await page.getByRole('button',{name:'Build cited brief'}).click();
    await page.getByText(expect).first().waitFor();
  }
  console.log('Passed real file chooser, partial batch, two-page on-device OCR, edits, citation, retraction, missing page and conflict checks.');
} finally {
  await browser.close();
}
