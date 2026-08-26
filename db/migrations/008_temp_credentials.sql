-- A password an advisor generated and emailed directly (no click-through
-- verification) is a weaker credential than a magic-link-verified one — it
-- sits in an inbox indefinitely rather than expiring after one use. This
-- flag makes it single-use in practice: the first login on it forces a
-- fresh, self-chosen password before anything else is reachable.
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
