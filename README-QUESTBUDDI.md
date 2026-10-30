# QuestBuddi — WebXR revival copy (2026-10-29)

This folder is the **revival working copy** of QuestBuddi. The original base is
untouched at `~/workspace/questpilot/webxr/`.

## What changed vs. the base (revival pass 1, 2026-10-29)

- User-visible branding rebranded **"AI Buddies" → "QuestBuddi"** throughout
  `index.html` and `app.js` (title is now "QuestBuddi — Gr8yzone Studios Inc.").
- Internal identifiers deliberately **kept** so nothing breaks: IndexedDB name,
  the `qp_lastError` / `qp_bootStages` startup-checker keys, and the avatar
  package format mark. Renaming those is a later, deliberate migration step.
- Startup checker verified present (it already shipped in the base): the global
  error trap is the first script in `index.html`, persists the last error to
  localStorage, and the viewer lives at **Settings → 🩺 App health / last error**
  with Copy / Clear.
- Verified 2026-10-29: `node --check app.js` passes; both files serve HTTP 200
  from a local static server. **Not yet verified in a headset** — that is the
  next step (see the revival plan).

## Run it

Serve this folder over HTTPS (WebXR requires a secure context) and open it in
the Quest Browser, e.g. any static host or a local tunnel. A-Frame 1.6.0 loads
from CDN, so the headset needs internet for the library; everything else is
on-device.

Full plan: `../questbuddi-revival-plan-2026-10-29.md`
