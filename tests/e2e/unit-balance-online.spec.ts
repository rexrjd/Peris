import {test,expect} from '@playwright/test';
// @ts-expect-error Isolated SQL/Auth adapter, never the configured live project.
import {accountServer} from '../helpers/account-server.mjs';

test('missing online balance metadata retains legacy inspection until the server advertises v2',async({page,context},info)=>{
 test.setTimeout(120000);
 const server=await accountServer(),errors:string[]=[];let upgraded=false;
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await context.addInitScript(()=>{
   localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
   const original=HTMLCanvasElement.prototype.getContext;
   HTMLCanvasElement.prototype.getContext=function(type:string,...args:unknown[]){
    if(['webgl','webgl2','experimental-webgl'].includes(type))return null;
    return Reflect.apply(original,this,[type,...args]);
   } as typeof original;
  });
  await context.route('**/*.supabase.co/**',async route=>{
   const request=route.request(),response=await server.request(request.url(),request.method(),request.headers(),request.postDataJSON()??{});
   // Exercise the older server's missing metadata contract in the real browser.
   // Recruitment commands/upgrade data preservation are tested by isolated SQL suites.
   if(!upgraded&&request.url().includes('/rpc/peris_snapshot')&&response.status===200)delete response.data.unit_balance_version;
   await route.fulfill({status:response.status,headers:response.headers,body:response.data==null?'':JSON.stringify(response.data)});
  });
  await page.goto('/');await page.getByRole('button',{name:'Shared world',exact:true}).click();
  await page.getByRole('button',{name:'Create account',exact:true}).click();await page.getByLabel('Name your ruler').fill('Balance browser ruler');
  await page.locator('.account-create .account-primary').click();await expect(page.getByLabel('Game menu')).toBeVisible();
  for(const version of [1,2]){
   if(version===2){upgraded=true;await page.reload();await expect(page.getByLabel('Game menu')).toBeVisible();}
   await page.getByRole('navigation',{name:'Game navigation'}).getByRole('button',{name:'Armies',exact:true}).click();
   await page.locator('.army-troop-grid .army-troop-inspect[data-unit="archers"]').click();
   const dialog=page.getByRole('dialog',{name:/ stats$/});await expect(dialog).toBeVisible();
   await expect(dialog.locator('.troop-unit-cost [title="gold per soldier"] b')).toHaveText(version===1?'2':'1');
   await expect(dialog.locator('.troop-dossier-recruit dl>div').filter({has:page.getByText('Train 10 soldiers',{exact:true})}).locator('dd')).toContainText(version===1?'0:20':'0:30');
   await expect(dialog.locator('.troop-dossier-combat [data-stat="attack"]')).toHaveAttribute('data-base',version===1?'60':'75');
   await page.screenshot({path:info.outputPath(`online-balance-v${version}.png`),fullPage:true});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  expect(errors).toEqual([]);
 }finally{await server.close();}
});
