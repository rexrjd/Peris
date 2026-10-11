import fs from 'node:fs/promises';
const source = (await fs.readFile('supabase/modules/campaign/report-reads.sql','utf8')).replace(/\r\n/g,'\n');
const snapshot = (await fs.readFile('supabase/modules/snapshot/peris_snapshot.sql','utf8')).replace(/\r\n/g,'\n');
const sql = `-- Existing name-only-account worlds; additive report read tracking only.
-- Apply with the report inbox frontend on a V17 world. No gameplay rules change.
begin;
${source}
${snapshot}
notify pgrst,'reload schema';
commit;
`;
const file = 'supabase/UPDATE_REPORT_READ_STATUS.sql';
if (process.argv.includes('--check')) {
    if ((await fs.readFile(file,'utf8')).replace(/\r\n/g,'\n') !== sql) throw Error('Stale report update: run npm run build:report-reads');
} else await fs.writeFile(file, sql);
console.log('Report read migration ' + (process.argv.includes('--check') ? 'matches' : 'generated'));
