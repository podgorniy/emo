-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Pausing reminders (architecture.md §9.1, api.md §2.5): the instant
-- until which the scheduler sends nothing to the account; NULL = not paused.
-- The moments planned meanwhile are kept with status 'paused', so the gap
-- stays in the reminder log and can be analysed (methodology.md §5.3).
ALTER TABLE accounts ADD COLUMN reminders_paused_until TEXT;
