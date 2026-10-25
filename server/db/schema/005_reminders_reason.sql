-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Why a reminder was never sent (architecture.md §6.1, api.md §2.8):
-- on a 'cancelled' row one of 'settings' (a mid-day settings change),
-- 'overdue' (not sent within its 30 minutes: the server was down),
-- 'no_device' (no subscription to send to), 'tz_change' (the account moved to
-- another time zone); NULL on every other row and on rows cancelled before
-- this column existed. A field, not more statuses, so older clients still read
-- the journal; the causes make the gaps in it analysable
-- (methodology.md §5.3).
ALTER TABLE reminders ADD COLUMN reason TEXT;
