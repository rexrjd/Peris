import fs from 'node:fs/promises';
const source = (await fs.readFile('supabase/modules/campaign/report-reads.sql','utf8')).replace(/\r\n/g,'\n');
const sql = `-- Existing name-only-account worlds; additive report read tracking only.
-- Apply with the compact-header frontend. No battle, camp or building rules change.
begin;
${source}
notify pgrst,'reload schema';
commit;
`;
const file = 'supabase/UPDATE_REPORT_READ_STATUS.sql';
if (process.argv.includes('--check')) {
    if ((await fs.readFile(file,'utf8')).replace(/\r\n/g,'\n') !== sql) throw Error('Stale report update: run npm run build:report-reads');
} else await fs.writeFile(file, sql);
console.log('Report read migration ' + (process.argv.includes('--check') ? 'matches' : 'generated'));
