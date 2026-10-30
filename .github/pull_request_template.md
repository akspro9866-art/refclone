## What changes

- [ ] Which stage(s) or module(s) does this touch?
- [ ] Is this generic-surface work (`catalog`, `autoanalyze`, `generic-design`,
      `generic-planner`, configs, skills, docs) or legacy `saas-reference` work?

## Evidence

The rule of this project is that a claim needs an artifact. Link the test, the
synthetic fixture, or the stage output that demonstrates the change.

```
npm test  ->  <paste the summary line>
```

- [ ] `npm test` passes locally.
- [ ] CI checks pass (syntax, config parity, skill parity, privacy scan).
- [ ] If a stage's output changed: the artifact fields that move, and the cache
      version constant that was bumped.
- [ ] `schemas/*.schema.json` updated for any new or renamed field.
- [ ] `docs/` and both skill copies updated (`.qoder/skills/**` and
      `.agents/skills/**`).
- [ ] `CHANGELOG.md` has an *Unreleased* line.

## Honest limits

What does this still not prove? Say it plainly - "renders correctly on one
16-frame synthetic clip" is a better answer than "works".
