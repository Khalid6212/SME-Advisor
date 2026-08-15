-- Password auth and admin-managed account status.
--
-- Extends D11 rather than replacing it: the magic link is still the only way
-- credentials ever move over email. It just no longer logs you straight in —
-- it authenticates you into a one-time "set your password" step, which also
-- doubles as the reset flow for an account that already has one. Regular
-- login afterward is email + password.

BEGIN;

CREATE TYPE user_status AS ENUM ('active', 'disabled');

ALTER TABLE users
  ADD COLUMN password_hash text,
  ADD COLUMN status user_status NOT NULL DEFAULT 'active';

COMMIT;
