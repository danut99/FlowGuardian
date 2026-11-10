import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Executes real Postgres grants, PL/pgSQL, RLS and triggers. Vault's API is a stub:
// encryption itself must be supplied by the actual Supabase Vault extension.
test('credential RPCs enforce ownership, worker-only reads, rotation and cascade cleanup', async () => {
  const db = new PGlite();
  const owner = '10000000-0000-0000-0000-000000000001';
  const other = '10000000-0000-0000-0000-000000000002';
  const site = '20000000-0000-0000-0000-000000000001';
  const flow = '30000000-0000-0000-0000-000000000001';
  async function as(role, uid = '') {
    await db.exec('reset role');
    await db.query("select set_config('app.uid', $1, false)", [uid]);
    await db.exec(`set role ${role}`);
  }
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema vault;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
      create table public.sites(id uuid primary key, owner_id uuid, url text, verified_at timestamptz);
      create table public.tests(id uuid primary key, site_id uuid references public.sites, name text, enabled boolean, status text);
      create table public.test_steps(test_id uuid references public.tests on delete cascade, position int, note text, value text);
      create table public.runs(test_id uuid references public.tests on delete cascade, status text);
      create function public.owns_test(tid uuid) returns boolean language sql security definer set search_path='' as $$
        select exists(select 1 from public.tests t join public.sites s on s.id=t.site_id where t.id=tid and s.owner_id=auth.uid())
      $$;
      create table vault.secrets(id uuid primary key default gen_random_uuid(), secret text, name text, description text);
      create view vault.decrypted_secrets as select id, secret as decrypted_secret from vault.secrets;
      create function vault.create_secret(new_secret text,new_name text,new_description text) returns uuid language plpgsql as $$
        declare result uuid; begin insert into vault.secrets(secret,name,description) values(new_secret,new_name,new_description) returning id into result; return result; end;
      $$;
      create function vault.update_secret(secret_id uuid,new_secret text) returns void language sql as $$update vault.secrets set secret=new_secret where id=secret_id$$;
    `);
    const migration = await readFile(new URL('../../supabase/migrations/0027_test_credentials.sql', import.meta.url), 'utf8');
    await db.exec(migration.replace('create extension if not exists supabase_vault with schema vault;', ''));
    await db.query('insert into public.sites values ($1,$2,$3,now())', [site, owner, 'https://fixture.example/']);
    await db.query("insert into public.tests values ($1,$2,'[Flow] Login',true,'approved')", [flow, site]);
    await db.query('insert into public.test_steps values ($1,1,$2,$3)', [flow, 'Flow v1|2000-01-01T00:00:00.000Z|Account dashboard', '{{test.username}}']);

    await as('authenticated', owner);
    await db.query('select public.set_test_credentials($1,$2,$3)', [flow, 'fixture-user', ' password with spaces ']);
    assert.equal((await db.query('select public.test_credentials_status($1) as saved', [flow])).rows[0].saved, true);
    await assert.rejects(db.query('select * from public.test_credentials'), /permission denied/);
    await assert.rejects(db.query('select * from vault.decrypted_secrets'), /permission denied/);
    await assert.rejects(db.query('select public.worker_test_credentials($1)', [flow]), /permission denied/);

    await as('authenticated', other);
    await assert.rejects(db.query('select public.test_credentials_status($1)', [flow]), /Flow not available/);
    await assert.rejects(db.query('select public.set_test_credentials($1,$2,$3)', [flow, 'other', 'other']), /Flow not available/);
    await as('anon');
    await assert.rejects(db.query('select public.test_credentials_status($1)', [flow]), /permission denied/);

    await as('service_role');
    assert.deepEqual((await db.query('select public.worker_test_credentials($1) as account', [flow])).rows[0].account,
      { username: 'fixture-user', password: ' password with spaces ' });
    await as('postgres');
    const state = (await db.query('select enabled,status from public.tests where id=$1', [flow])).rows[0];
    assert.deepEqual(state, { enabled: false, status: 'paused' });
    const note = (await db.query('select note,value from public.test_steps')).rows[0];
    assert.match(note.note, /Account dashboard$/);
    assert.ok(!note.note.includes('2000-01-01'));
    assert.equal(note.value, '{{test.username}}');

    await db.query("insert into public.runs values ($1,'running')", [flow]);
    await as('authenticated', owner);
    await assert.rejects(db.query('select public.set_test_credentials($1,$2,$3)', [flow, 'replacement', 'replacement']), /Wait for/);
    await as('postgres'); await db.exec('delete from public.runs');
    await as('authenticated', owner);
    await db.query('select public.set_test_credentials($1,$2,$3)', [flow, 'replacement', 'new password']);
    await as('service_role');
    assert.equal((await db.query('select public.worker_test_credentials($1) as account', [flow])).rows[0].account.password, 'new password');
    await as('authenticated', owner);
    await db.query('select public.set_test_credentials($1,null,null)', [flow]);
    assert.equal((await db.query('select public.test_credentials_status($1) as saved', [flow])).rows[0].saved, false);
    await as('postgres');
    assert.equal((await db.query('select count(*)::int as count from vault.secrets')).rows[0].count, 0);
    await as('authenticated', owner);
    await db.query('select public.set_test_credentials($1,$2,$3)', [flow, 'replacement', 'new password']);
    await as('postgres');
    await db.query("update public.sites set url='https://changed.example/' where id=$1", [site]);
    await as('service_role');
    assert.equal((await db.query('select public.worker_test_credentials($1) as account', [flow])).rows[0].account, null);
    await as('postgres');
    await db.query('delete from public.tests where id=$1', [flow]);
    assert.equal((await db.query('select count(*)::int as count from vault.secrets')).rows[0].count, 0);
    assert.equal((await db.query('select count(*)::int as count from public.test_credentials')).rows[0].count, 0);
  } finally { await db.close(); }
});
