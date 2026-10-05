import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),dist=path.join(root,'dist')
const target=path.resolve(process.argv[2]||path.join(root,'standalone','Peris-v7-playable.html'))
const mime={'.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2','.ttf':'font/ttf'}
const images={},variables={}
async function data(url){const file=path.resolve(dist,url.replace(/^\//,''));if(!file.startsWith(dist+path.sep))throw new Error(`Invalid asset: ${url}`);return `data:${mime[path.extname(file)]||'application/octet-stream'};base64,${(await fs.readFile(file)).toString('base64')}`}
async function image(url){if(!images[url]){images[url]=await data(url);variables[url]=`--peris-asset-${Object.keys(images).length}`}return variables[url]}
let html=await fs.readFile(path.join(dist,'index.html'),'utf8')
for(const[tag,url]of [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)]){
 let css=await fs.readFile(path.join(dist,url.replace(/^\//,'')),'utf8')
 for(const[full,asset]of [...css.matchAll(/url\(\s*['"]?([^'"\)]+)['"]?\s*\)/g)]){
  if(/^(data:|https?:|#)/.test(asset))continue
  const replacement=asset.startsWith('/art/')?`var(${await image(asset)})`:`url("${await data(asset)}")`
  css=css.split(full).join(replacement)
 }
 html=html.replace(tag,()=>`<style>${css.replace(/<\/style/gi,'<\\/style')}</style>`)
}
for(const[tag,url]of [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)]){
 let js=await fs.readFile(path.join(dist,url.replace(/^\//,'')),'utf8')
 for(const[full,asset]of [...js.matchAll(/["'](\/art\/[^"']+)["']/g)]){await image(asset);js=js.split(full).join(`globalThis.__PERIS_ASSETS__[${JSON.stringify(asset)}]`)}
 html=html.replace(tag,()=>`<script type="module">${js.replace(/<\/script/gi,'<\\/script')}</script>`)
}
html=html.replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g,'')
const icon=html.match(/<link\b[^>]*rel="icon"[^>]*href="([^"]+)"[^>]*>/)
if(icon){const value=await data(icon[1]);html=html.replace(icon[0],()=>icon[0].replace(icon[1],()=>value))}
const boot=`globalThis.__PERIS_ASSETS__=${JSON.stringify(images)};const vars=${JSON.stringify(variables)};for(const[url,key]of Object.entries(vars))document.documentElement.style.setProperty(key,'url("'+globalThis.__PERIS_ASSETS__[url]+'")');`
html=html.replace('</title>',()=>`</title><script>${boot}</script>`)
await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,html)
console.log(`Standalone ready: ${target} (${(Buffer.byteLength(html)/1024/1024).toFixed(2)} MB, ${Object.keys(images).length} embedded images)`)
