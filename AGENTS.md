# Project instructions

- Publish requested updates to `1702micky/segretariommg` after validation. Code changes require a new manifest version and a verified GitHub release with installer/update assets. Documentation-only changes do not require a new software version.
- Never commit patient reports, personal data, clinical logs, work directories or local backups. Use synthetic fixtures and explicit upload allowlists.
- Preserve the stable `manifest.key`, the local-only AI architecture, and `think: false` unless the user explicitly requests a change.
- Do not perform clinical interactions in Eumed as part of code verification. Do not press global save or prescription submission controls.
- Run applicable regression tests before publishing. Confirm the release workflow and assets, rather than reporting publication while a build is still running.
