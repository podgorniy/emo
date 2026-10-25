-- SPDX-License-Identifier: AGPL-3.0-or-later
-- One row per moment of a day's schedule (architecture.md §6.1). The generation
-- transaction keeps it to one schedule a day; this only stops duplicate rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_unique
  ON reminders(account_id, local_date, scheduled_for);
