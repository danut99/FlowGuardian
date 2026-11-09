-- Ownership verification disabled for now: new sites are auto-verified.
-- To re-enable: alter column verified_at drop default.
alter table public.sites alter column verified_at set default now();
update public.sites set verified_at = now() where verified_at is null;
