-- SPDX-License-Identifier: AGPL-3.0-or-later
-- The reminder pull pages on the time a row became visible to the client,
-- max(updated_at, scheduled_for) (api.md §2.8); the expression must
-- match server/routes/reminders.ts for SQLite to use the index.
DROP INDEX IF EXISTS idx_reminders_account_updated;
CREATE INDEX IF NOT EXISTS idx_reminders_account_visible
  ON reminders(account_id, max(updated_at, scheduled_for));
