import fs from 'node:fs/promises'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const manifest=JSON.parse(await fs.readFile(path.join(root,'supabase/modules/manifest.json'),'utf8'))
const normalizeNewlines=text=>text.replace(/\r\n/g,'\n')
const readSource=async file=>normalizeNewlines(await fs.readFile(file,'utf8'))
const chunks=await Promise.all(manifest.map(file=>readSource(path.join(root,'supabase/modules',file))))
const upgrade=chunks.join('')
const body=upgrade.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'')
const fresh=(await readSource(path.join(root,'supabase/modules/install/fresh-base.sql')))+body+(await readSource(path.join(root,'supabase/modules/install/fresh-tail.sql')))
const outputs={'UPGRADE_TO_V9.sql':upgrade,'FRESH_INSTALL_V9.sql':fresh,'UPGRADE_TO_V8.sql':upgrade,'UPGRADE_TO_V7.sql':upgrade,'UPGRADE_V5_TO_V6.sql':upgrade,'schema.sql':upgrade,'FRESH_INSTALL_V8.sql':fresh,'FRESH_INSTALL_V7.sql':fresh,'FRESH_INSTALL_V6.sql':fresh}
for(const[file,content]of Object.entries(outputs)){const target=path.join(root,'supabase',file);if(process.argv.includes('--check')){if(await readSource(target)!==content)throw Error('Stale SQL bundle: '+file)}else await fs.writeFile(target,content)}
console.log(process.argv.includes('--check')?'SQL bundles match modular source':'SQL bundles rebuilt')
