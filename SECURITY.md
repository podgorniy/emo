<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Security policy

Emo keeps people's journals; a flaw in its encryption, sign-in or server can
expose them. Please report security problems privately, not in a public issue.

## How to report

Use GitHub's private vulnerability reporting: the repository's **Security** tab
→ **Report a vulnerability**
([direct link](https://github.com/podgorniy/emo/security/advisories/new)).
Include what is affected, how to reproduce it, and what an attacker gains.
Please allow a reasonable time for a fix before you publish.

## In scope

- The end-to-end encryption: key derivation, wrapping, recovery, entry and
  bundle formats (`shared/crypto/`, `llm/architecture.md` §4–§5).
- Sign-in, sessions, invites and rate limits (`server/routes/`,
  `server/middleware/`).
- Anything that lets the server, its operator or a third party read entries, or
  that leaks emails, IP addresses or content into logs or responses.
- The Docker image, `compose.yml` and `Caddyfile` as shipped.

The threat model, including what Emo does not protect against (for example, a
server that serves malicious JavaScript), is in
[`llm/architecture.md`](llm/architecture.md) §2.

## Out of scope

- Problems of a particular instance's setup (its proxy, mail or host). Report
  those to its operator: Settings → About shows their contact.
- Denial of service by sheer volume.

Only the latest release and `main` get fixes.
