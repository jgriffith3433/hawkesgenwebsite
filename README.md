# hawkesgen.ai

Build browser games with friends and an AI assistant, and make their art, 3D, sound and music with Hawkes Gen.

- **The site:** the landing page, the games gallery (`/games`), the community library (`/community`), the engine codex
  (`/entities`), the Creator Studio (`/app`), accounts, credits and Stripe.
- **The game engine** (`public/play/`): Babylon.js with Havok physics, a small core plus modules (vehicles, mayhem,
  terrain, water, living things, homes), multiplayer rooms, and docs the assistant reads with every message.
- **Hawkes Gen is the backend** for all generation; the portal is one of its customers.

**`AGENTS.md` is the guide** (the hard rules, the layout, how to run, test and deploy). The engine's own guides are
`docs/engine-modules.md` (how to add to the engine) and `docs/engine-roadmap.md` (where it's going).

```bash
npm start            # http://127.0.0.1:8800 (see AGENTS.md for the .env it needs)
npm run typecheck
npm test             # offline, against a fake Gen; engine tests run Havok headlessly
```

Beta (J's Hawkes Studio login): https://hawkesgenwebsite.hawkesgen.ai/. Live: https://hawkesgen.ai/ (going live is
J's `DEPLOY hawkesgenwebsite` in Studio).
