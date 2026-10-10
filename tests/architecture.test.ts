import assert from 'node:assert/strict'
import {readdirSync,readFileSync,existsSync} from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import ts from 'typescript'
const root=path.resolve('src')
const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(path.join(dir,d.name)):/\.tsx?$/.test(d.name)?[path.join(dir,d.name)]:[])
const modules=walk(root)
const imports=(file:string)=>ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true).statements.filter(ts.isImportDeclaration)
const isType=(n:ts.ImportDeclaration)=>n.importClause?.isTypeOnly||!!n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings)&&!n.importClause.name&&n.importClause.namedBindings.elements.every(e=>e.isTypeOnly)
test('deployment inputs contain no unresolved merge conflicts',()=>{
 const sql=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?sql(path.join(dir,d.name)):d.name.endsWith('.sql')?[path.join(dir,d.name)]:[])
 for(const file of [path.resolve('package.json'),...modules,...sql(path.resolve('supabase'))]){
  assert.ok(!/^(?:<{7}(?: |$)|={7}$|>{7}(?: |$))/m.test(readFileSync(file,'utf8')),`Unresolved merge conflict: ${path.relative(process.cwd(),file)}`)
 }
})
test('gameplay domains cannot depend on rendering, UI, adapters or browser APIs',()=>{
 const domains=modules.filter(f=>f.split(path.sep).includes('domain'))
 assert.ok(domains.length>0,'No gameplay domains found; the architecture check must inspect domain modules')
 for(const file of domains){
  for(const n of imports(file)){const from=(n.moduleSpecifier as ts.StringLiteral).text;if(isType(n))continue
   assert.ok(!/react|platform|\/ui\/|\/rendering\/|\/engine\//.test(from),`${file}: forbidden runtime dependency ${from}`)
  }
  const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true)
  function inspect(n:ts.Node){if(ts.isIdentifier(n))assert.ok(!['window','document','localStorage','fetch','supabase','AudioContext'].includes(n.text),`${file}: browser API ${n.text}`);ts.forEachChild(n,inspect)}inspect(source)
 }
})
test('source runtime dependencies have no circular imports',()=>{
 const graph=new Map<string,string[]>()
 for(const file of modules){const targets:string[]=[];for(const n of imports(file)){if(isType(n))continue;const from=(n.moduleSpecifier as ts.StringLiteral).text;if(!from.startsWith('.'))continue;if(from.endsWith('.css')){assert.ok(existsSync(path.resolve(path.dirname(file),from)));continue}
  if(from.endsWith('.json')){const data=path.resolve(path.dirname(file),from);assert.ok(existsSync(data),`${file}: missing ${from}`);assert.doesNotThrow(()=>JSON.parse(readFileSync(data,'utf8')),`${file}: invalid JSON ${from}`);continue}
  const resolved=path.resolve(path.dirname(file),from),target=[resolved+'.ts',resolved+'.tsx'].find(existsSync);assert.ok(target,`${file}: missing ${from}`);targets.push(target)
 }graph.set(file,targets)}
 const active=new Set<string>(),finished=new Set<string>()
 function visit(file:string,trail:string[]){assert.ok(!active.has(file),'Runtime import cycle: '+[...trail,file].map(f=>path.relative(root,f)).join(' → '));if(finished.has(file))return;active.add(file);for(const next of graph.get(file)??[])visit(next,[...trail,file]);active.delete(file);finished.add(file)}
 for(const file of modules)visit(file,[])
})
