# Release recovery checkpoint

- **Date:** 2026-11-18
- **Status:** **0.0.16 NOT PUBLISHED; HETZNER ROUTE BROKEN; 0.0.17 IN PREPARATION**
- **Base commit:** `6739bb92aec0a22be0673277f384ff8f936c61d8` (PR #172, tag
  `v0.0.16`)

## Restart summary

The goal is to publish preview 0.0.17: the first preview whose Hetzner route
works against the current Hetzner API, and the first backed by a completed
operational soak on AWS and Hetzner. No 48- or 72-hour soak has ever completed.

The published preview is 0.0.15. Version 0.0.16 was tagged and built but never
published. Both carry a Hetzner defect that Hetzner's API change exposed on
2026-11-02. The next release is 0.0.17, because the `v0.0.16` tag stays where
it is.

This checkpoint records state only. It makes no product-direction change. The
priorities in [ROADMAP.md](../../ROADMAP.md) are unchanged.

## State at 2026-11-18

| Area                   | State                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository             | `master` equals `origin/master` at `6739bb92`. CI is green.                                                                                                                                                                                                                                                                                           |
| npm `@wharfie/wharfie` | `latest` 0.0.14, `preview` 0.0.15, `preview-candidate` 0.0.15, `next` 0.0.13-0. Version 0.0.16 was never published. `@wharfie/aws` ships as a release tarball, not on npm.                                                                                                                                                                            |
| Held release run       | The `v0.0.16` release run built and attested its candidate, then stopped at the `publish` job. It has waited for `npm-preview` approval since November 5 and times out by itself. It should not be approved.                                                                                                                                          |
| Hetzner route          | Broken in 0.0.15 and 0.0.16. See below.                                                                                                                                                                                                                                                                                                               |
| Operational soak       | None has completed. September stopped after about fifteen hours for a reason never established. November failed at the Hetzner rehearsal.                                                                                                                                                                                                             |
| Cloud                  | The November controller stack is `DELETE_COMPLETE` and its instance is terminated. The post-teardown observation on 2026-11-18 found no controller volumes, no Elastic IPs, no campaign security groups, and no active instances in the region. Two private proof buckets are retained on purpose. The Hetzner project is empty (plan, not receipts). |
| Soak tooling           | The controller that runs soaks unattended exists only in a gitignored directory on one laptop. It is not in the repository. It has a known defect in how it handles a run that failed before creating anything.                                                                                                                                       |
| Docs                   | `https://docs.wharfie.dev/` serves the v0.0.15 page through CloudFront. PR #171 is an open draft that would move hosting to an S3 website behind Cloudflare.                                                                                                                                                                                          |
| Issues and PRs         | Seven open issues (#126, #127, #128, #131, #132, #136, #137). One open PR (#171).                                                                                                                                                                                                                                                                     |
| Testers                | None recruited. A checklist exists and was never sent.                                                                                                                                                                                                                                                                                                |

## What failed in November and why

Hetzner removed the `deprecated` field from image responses on 2026-11-02
([Hetzner changelog](https://docs.hetzner.cloud/changelog)). The decoder
`decodeHetznerImage` in
`src/core/runtime/providers/hetzner/api-documents.js` still requires that field
and rejects the response. As a result, `preview` on Hetzner fails with "Hetzner
API response document is invalid." It fails before anything is created.

The November soak campaign for 0.0.16 ran a 15-minute rehearsal on each
provider first. The AWS rehearsal passed and cleaned up. The Hetzner rehearsal
failed for the reason above, so the campaign stopped there. It stays recorded as
failed. A failed campaign is never resumed into a pass. Its controller was torn
down and verified absent on 2026-11-18.

The fix is [PR #175](https://github.com/wharfie/wharfie/pull/175). It was not
merged when this checkpoint was written, and 0.0.17 is the first release planned
to carry it.

## What merged since the last checkpoint

PRs #159–#172 (excluding the open draft #171 and #170, which did not merge) are
summarized in the
[Since September 2](../../ROADMAP.md#since-september-2) section of the roadmap.
In short: remote recovery of a crashed resident (#160), repeatable live AWS and
Hetzner acceptance including crash, reboot, and update (#161–#163), a recipient
handoff and release-recovery path (#164, #166, #167), bounded soaks (#165),
journal-capacity measurement (#168), tester handoff and docs hosting templates
(#169), and consumer dependency cleanup with the 0.0.16 version (#172).

The live acceptance runs in #161–#163 passed on both providers in September,
before Hetzner's change. They do not show the Hetzner route working today.

## Plan and next steps

The work is laid out in `docs/plans/2026-11-release-plan.md`, an untracked local
file that is not in the repository. In order:

1. Track A, unblock the release: fix Hetzner image decoding and check the rest
   of the Hetzner contract; bring the soak controller into the repository and
   fix it; pin CI runner images; publish a known-issue note for 0.0.15 on
   Hetzner; refresh the roadmap and charter (this checkpoint); triage open
   issues; clean up the local checkout.
2. Track B, release 0.0.17: bump the version, tag and build the candidate,
   verify and freeze it, run the campaign, publish and promote, update docs.
3. Track C, not blocking: classify the macOS native abort in local test runs,
   prepare tester outreach, resolve PR #171.

Publication, promotion, tag pushes, cloud mutation, and DNS changes need the
maintainer. Nothing in this checkpoint authorizes them.

## Evidence limits

- The npm dist-tags and the `v0.0.16` tag were read on 2026-11-18. The held run
  and the Hetzner project state are as recorded in the plan; they are not
  reproducible from the repository.
- The teardown evidence is in ignored files in the maintainer's main checkout:
  `tmp/wharfie-release-20261104/teardown-20261118/teardown-receipt.json` and
  `post-teardown-observation.json`. The receipt records campaign status
  `failed`, the Hetzner rehearsal failing at phase `preview` with
  `cleanupStatus` `not-created`, and the campaign controller deleted with the
  proof bucket retained. The observation shows the stack and instance gone and
  the retained buckets present. The AWS rehearsal result is from the plan only.
- No soak receipts exist for any release. The September and November campaign
  evidence is outside the repository, in ignored local directories and two
  retained private buckets.
- No unfamiliar-tester trial has taken place.
