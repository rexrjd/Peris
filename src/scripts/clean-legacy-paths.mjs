import fs from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const manifest=JSON.parse(await fs.readFile(path.join(root,'scripts/legacy-paths.json'),'utf8'))
let removed=0,conflicts=0
for(const[relative,hashes]of Object.entries(manifest)){
 if(!/^(src|public\/art)\//.test(relative)||relative.includes('..'))throw Error('Unsafe manifest path')
 const file=path.join(root,relative)
 let bytes;try{bytes=await fs.readFile(file)}catch(e){if(e.code==='ENOENT')continue;throw e}
 if(!hashes.includes(createHash('sha256').update(bytes).digest('hex'))){console.error('Preserved locally modified legacy file: '+relative);conflicts++;continue}
 if(process.argv.includes('--check'))console.log('Legacy file to remove: '+relative)
 else{await fs.unlink(file);removed++}
}
console.log(process.argv.includes('--check')?'Legacy scan finished':`Removed ${removed} unchanged legacy files; preserved ${conflicts} modified files.`)
if(conflicts){console.error('Move preserved files outside src before building, and merge any personal edits into the new feature modules.');process.exitCode=1}
