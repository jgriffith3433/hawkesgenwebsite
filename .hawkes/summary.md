# Hawkes Net friends flow: beta build

**What was wrong:** beta's build failed because Studio ran out of credits ("playtest.run needs 9 and 1 is left"). That is a billing limit, not a code error. The branch has no compile problem: `cd cloud/functions && npx tsc -p .` passes, and `test/invite.test.ts` and `test/playtest.test.ts` pass (13 of 13).

**What is already in this change (nothing new to the code):**
- The island's button now says *Copy invite link* and copies the invite link (`public/play/guest.js`).
- When the friend arrives, the first player sees the Overseer's "Someone is coming." / "<name> is here." and a card, "<name> joined your island" (`[data-invite=welcome]`, closes after 8 s or on ✕).
- The `island-invite` scenario (`public/playtest/portal.js` `stageInvite`) checks the button text, the link, the friend joining and the arrival card (`welcome-moment`).

**For J:** add credits or upgrade the plan in Settings, then re-run beta's playtest. Until then it will fail the same way. I did not run the playtest myself (no browser, and the credits are out).

**GPU:** none used. Estimate: nothing to price.
