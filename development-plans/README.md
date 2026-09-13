# Development plans

Every development plan in this project is written in English. The [master plan](personal-business-goals-dashboard-master-plan.md) is the source of product scope and technology decisions. Implement the stage plans in order; each contains concrete tasks, dependencies, acceptance tests, and a rollback note. Completed stage plans move to [`archived/`](archived/); keep their links and any relative links inside the plans working after a move.

Adversarial review completed on 2026-09-12 for all seven plans. The review checked stage ordering, API/schema compatibility, concurrent writes, recovery and secret handling, RTL/accessibility, Free-tier feasibility gates, and backup/restore failure paths; findings were incorporated into the plans.

Stage 1 was completed on 2026-09-13. The [deployed feasibility report](../docs/stage-1-feasibility.md) records the passing Free-tier gate before Stage 2.

Stage 2 was completed on 2026-09-13. The [Stage 2 completion report](../docs/stage-2-completion.md) records the deployed test evidence, the measured serialisation of key derivation in the Free runtime, and the decision to proceed to Stage 3.

Stages 3, 4, and 5 were completed on 2026-09-13; see the [Stage 3](../docs/stage-3-completion.md), [Stage 4](../docs/stage-4-completion.md), and [Stage 5](../docs/stage-5-completion.md) completion reports.

**Stage 6 is implemented and locally verified but not closed.** It is one step short, and that step needs a person: a manual screen-reader review in all three locales. The [Stages 2–6 execution log](../docs/stages-2-6-execution-log.md) records exactly what remains, and [`handoff-remaining-checks.md`](handoff-remaining-checks.md) is the brief for whoever picks it up.

On 2026-09-13, the Stage 2 account plan was extended with an owner-managed allowed-email list. Its API and authorization rules are in Stage 2; recovery, board, UI, localization, and backup implications are reflected in Stages 3–7 and the master plan.

The [autonomous execution prompt for Stages 2–6](execute-stages-2-through-6-autonomously.md) has been executed but **stays here**, because it may only move to `archived/` once all five deployed stage gates pass. Stages 2, 3, 4, and 5 passed; Stage 6 has one outstanding check that needs a person, described above.

| Stage | Plan |
| --- | --- |
| 1 (complete) | [Hosting and security feasibility](archived/stage-1-hosting-security-feasibility.md) |
| 2 (complete) | [Users, invitations, and sessions](archived/stage-2-users-invitations-sessions.md) |
| 3 (complete) | [Recovery and manual rescue](archived/stage-3-recovery-manual-rescue.md) |
| 4 (complete) | [Board API](archived/stage-4-board-api.md) |
| 5 (complete) | [Board and account UI](archived/stage-5-board-account-ui.md) |
| 6 | [Localization and accessibility](stage-6-localization-accessibility.md) |
| 7 | [Backup, hardening, and release](stage-7-backup-hardening-release.md) |
