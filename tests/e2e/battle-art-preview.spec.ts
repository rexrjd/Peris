import { test,expect,type Locator } from '@playwright/test';

// Read after the renderer's animation callback, before WebGL discards its back buffer.
// A selected formation stays centered while orbiting, so its label is not an orbit signal.
async function battlefieldPixels(field:Locator) {
    return field.evaluate((canvas:HTMLCanvasElement)=>new Promise<number>((resolve,reject)=>requestAnimationFrame(()=>{
        const gl=canvas.getContext('webgl2');if(!gl){reject(new Error('Missing prototype WebGL context'));return;}
        const width=Math.min(128,canvas.width),height=Math.min(128,canvas.height),pixels=new Uint8Array(width*height*4);
        gl.readPixels(Math.floor((canvas.width-width)/2),Math.floor((canvas.height-height)/2),width,height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
        let hash=2166136261;for(const pixel of pixels)hash=Math.imul(hash^pixel,16777619);
        resolve(hash>>>0);
    })));
}

test('army preview supports mesh inspection, deployment, combat, quality changes and 2D fallback without touching a campaign',async({page},testInfo)=>{
    test.setTimeout(120000);
    const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));localStorage.setItem('peris-solo-v6','preserve-this-campaign');});
    await page.goto('/?battle-preview=1&legacy-units=1');
    const field=page.locator('.battle-3d-canvas canvas');
    await expect(page.locator('.army-loading')).toHaveCount(0,{timeout:60000});
    await expect(page.locator('.battle-3d-label.friendly')).toHaveCount(7);
    await expect(page.locator('.unit-card')).toHaveCount(7);
    const deploymentHeight=(await page.locator('.deployment-banner').boundingBox())!.height;
    await page.getByRole('button',{name:'Inspect selected troops',exact:true}).click();
    await expect(page.locator('.tactical-shell')).toHaveClass(/model-inspection/);
    expect((await page.locator('.deployment-banner').boundingBox())!.height).toBeLessThan(deploymentHeight);
    await expect(page.locator('.army-inspection small')).toContainText('FPS',{timeout:20000});
    if(testInfo.project.name==='mobile-chromium')await page.getByRole('button',{name:'Zoom in',exact:true}).tap();
    else{await field.hover();await page.mouse.wheel(0,-300);}
    await page.screenshot({path:testInfo.outputPath('orc-inspection.png')});
    await page.locator('.unit-card').last().click();
    await page.getByRole('button',{name:'Inspect selected troops',exact:true}).click();
    await page.screenshot({path:testInfo.outputPath('mammoth-inspection.png')});
    await page.getByRole('button',{name:'Inspect catapult',exact:true}).click();
    await page.screenshot({path:testInfo.outputPath('stonehurler.png')});
    await page.getByRole('button',{name:'Battle overview',exact:true}).click();
    await expect(page.locator('.tactical-shell')).not.toHaveClass(/model-inspection/);
    expect((await page.locator('.deployment-banner').boundingBox())!.height).toBe(deploymentHeight);
    await page.locator('.unit-card').first().click();
    const label=page.locator('.battle-3d-label.friendly.selected').first(),before=await label.getAttribute('style');
    await page.getByRole('button',{name:'Move',exact:true}).click();
    const box=await field.boundingBox();if(!box)throw new Error('Missing battlefield');
    await field.click({position:{x:box.width*.24,y:box.height*.7}});
    await expect(label).not.toHaveAttribute('style',before!);
    await page.getByRole('button',{name:'Begin battle',exact:true}).click();
    await expect(page.locator('.deployment-banner')).toHaveCount(0);
    await page.getByRole('button',{name:/Ⅱ Pause/}).click();
    await expect(page.locator('.pause-banner')).toBeVisible();
    const selection=await page.locator('.command-selection').innerText();
    await page.getByLabel('Graphics quality').selectOption('balanced');
    await expect(page.locator('.army-loading')).toHaveCount(0,{timeout:60000});
    await expect(page.locator('.command-selection')).toHaveText(selection);
    await expect(page.locator('.pause-banner')).toBeVisible();
    await field.evaluate((canvas:HTMLCanvasElement)=>canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext());
    await expect(page.getByRole('status').filter({hasText:'3D graphics unavailable'})).toBeVisible();
    await expect(page.locator('canvas[aria-label^="Tactical battlefield"]')).toBeVisible();
    await expect(page.locator('.pause-banner')).toBeVisible();
    expect(await page.evaluate(()=>localStorage.getItem('peris-solo-v6'))).toBe('preserve-this-campaign');
    expect(errors).toEqual([]);
});

test('all eleven factions load published meshes or explicit withheld fallbacks and their own portraits',async({page},testInfo)=>{
    test.setTimeout(240000);
    if(testInfo.project.name==='mobile-chromium')test.skip();
    const errors:string[]=[],assets=new Map<string,number>();page.on('pageerror',e=>errors.push(e.message));
    page.on('response',response=>{const path=new URL(response.url()).pathname;if(path.match(/\/models\/battle\/.+-(?:roster|army)(?:-lod)?\.glb$/))assets.set(path,response.status());});
    const report=await (await page.request.get('/models/battle/faction-rosters.json')).json();
    const enabled=(faction:string)=>!report.withheld?.[faction]&&!!report.factions?.[faction]?.near&&!!report.factions?.[faction]?.far;
    const pack=(faction:string)=>enabled(faction)&&enabled('roman')?'textured':enabled(faction)||enabled('roman')?'mixed':'earlier';
    await page.goto('/?battle-preview=1');
    await expect(page.locator('.battle-art-preview')).toHaveAttribute('data-model-pack',pack('orc'));
    for(const faction of ['roman','spartan','persian','egyptian','orc','elf','dwarf','gnome','pandaren','undead','demon']){
        await page.getByLabel('Your faction').selectOption(faction);
        await expect(page.locator('.battle-art-preview')).toHaveAttribute('data-model-pack',pack(faction));
        await expect(page.locator('.army-loading')).toHaveCount(0,{timeout:60000});
        await expect(page.locator('.battle-3d-label.friendly')).toHaveCount(7);
        for(const suffix of ['','-lod'])await expect.poll(()=>assets.get(`/models/battle/${faction}-${enabled(faction)?'roster':'army'}${suffix}.glb`),{timeout:60000}).toBe(200);
        await expect(page.locator('.unit-card .faction-portrait').first()).toHaveAttribute('style',new RegExp(`/roster/${faction}.png`));
    }
    expect(errors).toEqual([]);
});

test('a published Roman roster remains visible when its chosen opponent only has the earlier pack',async({page},testInfo)=>{
    test.setTimeout(120000);
    const errors:string[]=[],assets=new Map<string,number>();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{const path=new URL(response.url()).pathname;if(path.match(/\/models\/battle\/(roman|orc)-(army|roster)/))assets.set(path,response.status());});
    await page.route('**/models/battle/faction-rosters.json',route=>route.fulfill({json:{factions:{roman:{near:{},far:{}},orc:{near:{},far:{}}},withheld:{orc:{reason:'Explicit quality review withholding'}}}}));
    await page.addInitScript(()=>{
        localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
        localStorage.setItem('peris-solo-v6','preserve-mixed-campaign');
    });
    await page.goto('/?battle-preview=1&unit-prototypes=1');
    await expect(page.locator('.battle-art-preview')).toHaveAttribute('data-model-pack','mixed');
    await expect(page.locator('.army-loading')).toHaveCount(0,{timeout:90000});
    await expect(page.locator('.battle-3d-label.friendly')).toHaveCount(7);
    await expect(page.getByLabel('Your faction')).toHaveValue('roman');
    await expect(page.getByLabel('Enemy faction')).toHaveValue('orc');
    await expect(page.locator('.preview-toolbar small')).toContainText('Roman: textured models');
    await expect(page.locator('.preview-toolbar small')).toContainText('Orcs: earlier models');
    for(const suffix of ['','-lod']){
        expect(assets.get(`/models/battle/roman-roster${suffix}.glb`)).toBe(200);
        expect(assets.get(`/models/battle/orc-army${suffix}.glb`)).toBe(200);
    }
    await page.getByLabel('Inspect unit role').selectOption('heavy_cavalry');
    await expect(page.locator('.commander-panel h2')).toHaveText('Armored Lancer');
    await page.screenshot({path:testInfo.outputPath('mixed-published-roman-cavalry.png')});
    expect(await page.evaluate(()=>localStorage.getItem('peris-solo-v6'))).toBe('preserve-mixed-campaign');
    expect(errors).toEqual([]);
});

test('textured faction rosters inspect all nine roles and keep orders, pause state and campaign isolation in the battle renderer',async({page},testInfo)=>{
    test.setTimeout(150000);
    const errors:string[]=[],assets=new Map<string,number>();
    page.on('pageerror',error=>errors.push(error.message));
    page.on('response',response=>{
        const path=new URL(response.url()).pathname;
        if(path.match(/\/models\/battle\/(roman|orc)-(?:roster|army)/))assets.set(path,response.status());
    });
    await page.addInitScript(()=>{
        localStorage.setItem('peris-settings',JSON.stringify({sound:false,music:false,reducedMotion:true}));
        localStorage.setItem('peris-solo-v6','preserve-prototype-campaign');
    });
    const report=await (await page.request.get('/models/battle/faction-rosters.json')).json();
    const enemyPublished=!report.withheld?.orc&&!!report.factions?.orc?.near&&!!report.factions?.orc?.far;
    await page.goto('/?battle-preview=1&unit-prototypes=1');
    await expect(page.locator('.battle-art-preview')).toHaveAttribute('data-model-pack',enemyPublished?'textured':'mixed');
    const field=page.locator('.battle-3d-canvas canvas');
    await expect(page.locator('.army-loading')).toHaveCount(0,{timeout:90000});
    await expect(field).toBeVisible();
    await expect(page.getByLabel('Your faction')).toHaveValue('roman');
    await expect(page.getByLabel('Enemy faction')).toHaveValue('orc');
    await expect(page.locator('.battle-3d-label.friendly')).toHaveCount(7);
    for(const faction of ['roman','orc'])for(const suffix of ['','-lod'])expect(assets.get(`/models/battle/${faction}-${faction==='orc'&&!enemyPublished?'army':'roster'}${suffix}.glb`)).toBe(200);
    await expect(page.getByRole('link',{name:'Unit asset credits',exact:true})).toHaveAttribute('href','/licenses/peris-faction-rosters.txt');
    const credits=await page.request.get('/licenses/peris-faction-rosters.txt');
    expect(credits.ok()).toBe(true);
    expect(await credits.text()).toMatch(/Wildfire Games[\s\S]+CC BY-SA 3\.0/);

    const inspector=page.getByLabel('Inspect unit role');
    await expect(inspector.locator('option')).toHaveCount(10);
    for(const role of ['line_infantry','spear_guard','archer','elite','scout','light_cavalry','heavy_cavalry','ram','catapult']){
        await inspector.selectOption(role);
        await expect(inspector).toHaveValue(role);
        await expect(page.locator('.tactical-shell')).toHaveClass(/model-inspection/);
        if(role!=='ram'&&role!=='catapult'){
            const name=await inspector.locator(`option[value="${role}"]`).innerText();
            await expect(page.locator('.commander-panel h2')).toHaveText(name);
            await expect(page.locator('.unit-card.selected')).toHaveCount(1);
        } else {
            const name=await inspector.locator(`option[value="${role}"]`).innerText();
            await expect(page.locator('.siege-study h2')).toHaveText(name);
            await expect(page.locator('.command-meters')).toHaveCount(0);
            await expect(page.locator('.command-unit-art')).not.toContainText('soldiers');
        }
    }

    await page.locator('.unit-card').first().click();
    await page.getByRole('button',{name:'Inspect selected troops',exact:true}).click();
    await expect(page.locator('.army-inspection small')).toContainText('FPS',{timeout:20000});
    await page.screenshot({path:testInfo.outputPath('licensed-roman-infantry.png')});
    await page.locator('.unit-card').last().click();
    await page.getByRole('button',{name:'Inspect selected troops',exact:true}).click();
    const selected=page.locator('.battle-3d-label.friendly.selected').first();
    let beforeOrbit=await battlefieldPixels(field),matchingFrames=0;
    await expect.poll(async()=>{
        const pixels=await battlefieldPixels(field);
        matchingFrames=pixels===beforeOrbit?matchingFrames+1:0;beforeOrbit=pixels;
        return matchingFrames;
    }).toBeGreaterThanOrEqual(2);
    await page.getByRole('button',{name:'Rotate camera right',exact:true}).click();
    await expect.poll(()=>battlefieldPixels(field)).not.toBe(beforeOrbit);
    await page.screenshot({path:testInfo.outputPath('licensed-roman-cavalry.png')});

    await page.getByRole('button',{name:'Battle overview',exact:true}).click();
    await page.locator('.unit-card').first().click();
    const beforeMove=await selected.getAttribute('style');
    await page.getByRole('button',{name:'Move',exact:true}).click();
    const box=await field.boundingBox();if(!box)throw new Error('Missing prototype battlefield');
    await field.click({position:{x:box.width*.24,y:box.height*.7}});
    await expect(selected).not.toHaveAttribute('style',beforeMove!);
    await page.getByRole('button',{name:'Begin battle',exact:true}).click();
    await expect(page.locator('.deployment-banner')).toHaveCount(0);
    await page.getByRole('button',{name:/Ⅱ Pause/}).click();
    await expect(page.locator('.pause-banner')).toBeVisible();
    const selection=await page.locator('.command-selection').innerText();
    await page.getByLabel('Graphics quality').selectOption('balanced');
    await expect(page.locator('.army-loading')).toHaveCount(0,{timeout:90000});
    await expect(page.locator('.command-selection')).toHaveText(selection);
    await expect(page.locator('.pause-banner')).toBeVisible();
    await field.evaluate((canvas:HTMLCanvasElement)=>canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext());
    await expect(page.getByRole('status').filter({hasText:'3D graphics unavailable'})).toBeVisible();
    await expect(page.locator('canvas[aria-label^="Tactical battlefield"]')).toBeVisible();
    await expect(page.locator('.pause-banner')).toBeVisible();
    expect(await page.evaluate(()=>localStorage.getItem('peris-solo-v6'))).toBe('preserve-prototype-campaign');
    expect(errors).toEqual([]);
});
