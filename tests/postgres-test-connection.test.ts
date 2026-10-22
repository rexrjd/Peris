import test from 'node:test';
import assert from 'node:assert/strict';
import { testConnection } from './helpers/testPostgres';
test('database stress tools refuse production, arbitrary remote hosts and non-test databases', () => {
    for (const input of [undefined, 'postgresql://postgres@db.chtktuadlsnqgiisdcom.supabase.co/postgres', 'postgresql://localhost/postgres', 'postgresql://remote/peris_test_demo', 'https://localhost/peris_test_demo', 'postgresql://localhost/peris_test_demo?host=remote']) {
        assert.throws(() => testConnection(input), /isolated|loopback|production/i);
    }
    assert.equal(testConnection('postgresql://tester@127.0.0.1:55432/peris_test_clock').port, '55432');
});
