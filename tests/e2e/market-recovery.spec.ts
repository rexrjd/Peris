import {test,expect} from '@playwright/test';
import {createSolo} from '../../src/features/campaign/domain/newRealm';
test('an authoritative recovered shipment clears its stale review before another confirmation',async({page})=>{
 const world=createSolo('Recovered trade'),owner='11111111-1111-4111-8111-111111111111',s=world.settlements[0];
 s.owner_id=owner;s.wood=s.stone=s.food=s.gold=3000;world.players[0].id=owner;world.settlements.push({...s,id:2,name:'Recipient city',x:s.x+128});world.city_slots=[{settlement_id:s.id,slot_index:0,building_type:'bazaar',level:2}];
 let targetsUnavailable=true;await page.route('**/rest/v1/rpc/peris_trade_targets',route=>targetsUnavailable?route.fulfill({status:400,json:{code:'55P03',message:'Target cities are settling. Try again.'}}):route.fulfill({json:[{id:3,name:'Guild member city',owner_id:'22222222-2222-4222-8222-222222222222',owner_name:'Guildmate',x:s.x+256,y:s.y}]}));await page.goto('/');
 await page.evaluate(async({world,owner})=>{
  const reactPath='/node_modules/.vite/deps/react.js',domPath='/node_modules/.vite/deps/react-dom_client.js',panelPath='/src/features/city/ui/MarketPanel.tsx';
  const react=await import(reactPath),React=react.default??react,dom=await import(domPath),{MarketPanel}=await import(panelPath),createRoot=dom.createRoot??dom.default.createRoot;
  document.getElementById('root')!.style.display='none';const host=document.createElement('div');host.style.cssText='max-width:390px;margin:30px;padding:20px;background:#30281f;color:#eadfc7';document.body.append(host);const root=createRoot(host);
  const send=async(command:any)=>{(window as any).lastMarketCommand=command;throw new Error('Connection interrupted. Retry the saved order.');};
  const render=()=>root.render(React.createElement(MarketPanel,{world,owner,sid:world.settlements[0].id,now:Date.parse(world.server_now),busy:false,onSend:send}));render();
  (window as any).acceptMarketShipment=()=>{
   const now=Date.parse(world.server_now),cargo={wood:100,stone:0,food:0,gold:0},zero={wood:0,stone:0,food:0,gold:0};
   world={...world,trade_caravans:[{id:400,owner_id:owner,recipient_id:'22222222-2222-4222-8222-222222222222',source_settlement_id:world.settlements[0].id,target_settlement_id:3,source_city:world.settlements[0].name,target_city:'Guild member city',resources:cargo,returning_resources:zero,delivered_resources:zero,volume:100,march_path:[[64,64],[320,64]],departure_at:world.server_now,arrival_at:new Date(now+10000).toISOString(),return_at:new Date(now+20000).toISOString(),status:'outbound'}]};render();
  };
 },{world,owner});
 await expect(page.getByRole('alert')).toContainText('Could not load guild cities');targetsUnavailable=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByLabel('Trade destination city').selectOption('3');
 await page.getByLabel('Wood to send').fill('100');await page.getByRole('button',{name:'Review shipment',exact:true}).click();await expect(page.getByText('Guild member city',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Confirm shipment',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Connection interrupted');
 expect(await page.evaluate(()=>(window as any).lastMarketCommand.targetCityId)).toBe(3);
 await page.evaluate(()=>(window as any).acceptMarketShipment());
 await expect(page.getByRole('button',{name:'Confirm shipment',exact:true})).toHaveCount(0);await expect(page.getByLabel('Wood to send')).toHaveValue('0');await expect(page.getByRole('status')).toContainText('Caravan dispatched');
});
