Beta's build failure ("Gen is restarting, try again in a few seconds") was a transient Gen outage during the build, not a code error. The change from the earlier attempt (#194) is already on this branch: community.ts stops listing files that 404, community.html wraps the tabs at 390 px, entities.html and avatars.html hide the `.ct-btn` Controls pill, and the `community-library` playtest checks the community page.
Checks: `cd cloud/functions && npm ci && npx tsc -p .` passes. No new code changes were needed; this pass is a rebuild of the same commit.
GPU: none used, nothing to estimate.
