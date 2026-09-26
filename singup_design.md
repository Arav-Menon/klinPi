# Log In

## Mission
Create implementation-ready, token-driven UI guidance for Log In that is optimized for consistency, accessibility, and fast delivery across dashboard web app.

## Brand
- Product/brand: Log In
- URL: https://www.sim.ai/login
- Audience: authenticated users and operators
- Product surface: dashboard web app

## Style Foundations
- Visual style: clean, functional, implementation-oriented
- Main font style: `font.family.primary=season`, `font.family.stack=season, season Fallback, system-ui, Segoe UI, Roboto, Helvetica Neue, Arial, Noto Sans`, `font.size.base=14px`, `font.weight.base=400`, `font.lineHeight.base=20px`
- Typography scale: `font.size.xs=12px`, `font.size.sm=13px`, `font.size.md=14px`, `font.size.lg=15px`, `font.size.xl=16px`, `font.size.2xl=32px`
- Color palette: `color.text.primary=#1a1a1a`, `color.text.secondary=#525252`, `color.text.tertiary=#7a7a7a`, `color.text.inverse=#434343`, `color.surface.base=#000000`, `color.surface.muted=#fefefe`, `color.border.default=#d8d8d8`
- Spacing scale: `space.1=4px`, `space.2=8px`, `space.3=16px`, `space.4=48px`, `space.5=237px`
- Radius/shadow/motion tokens: `radius.xs=8px` | `motion.duration.instant=150ms`

## Accessibility
- Target: WCAG 2.2 AA
- Keyboard-first interactions required.
- Focus-visible rules required.
- Contrast constraints required.

## Writing Tone
Concise, confident, implementation-focused.

## Rules: Do
- Use semantic tokens, not raw hex values, in component guidance.
- Every component must define states for default, hover, focus-visible, active, disabled, loading, and error.
- Component behavior should specify responsive and edge-case handling.
- Interactive components must document keyboard, pointer, and touch behavior.
- Accessibility acceptance criteria must be testable in implementation.

## Rules: Don't
- Do not allow low-contrast text or hidden focus indicators.
- Do not introduce one-off spacing or typography exceptions.
- Do not use ambiguous labels or non-descriptive actions.
- Do not ship component guidance without explicit state rules.

## Guideline Authoring Workflow
1. Restate design intent in one sentence.
2. Define foundations and semantic tokens.
3. Define component anatomy, variants, interactions, and state behavior.
4. Add accessibility acceptance criteria with pass/fail checks.
5. Add anti-patterns, migration notes, and edge-case handling.
6. End with a QA checklist.

## Required Output Structure
- Context and goals.
- Design tokens and foundations.
- Component-level rules (anatomy, variants, states, responsive behavior).
- Accessibility requirements and testable acceptance criteria.
- Content and tone standards with examples.
- Anti-patterns and prohibited implementations.
- QA checklist.

## Component Rule Expectations
- Include keyboard, pointer, and touch behavior.
- Include spacing and typography token requirements.
- Include long-content, overflow, and empty-state handling.
- Include known page component density: buttons (7), links (4), inputs (2), navigation (2).

- Extraction diagnostics: Low sample size: fewer than 30 visible elements were extracted. Audience and product surface inference confidence is low; verify generated brand context.

## Quality Gates
- Every non-negotiable rule must use "must".
- Every recommendation should use "should".
- Every accessibility rule must be testable in implementation.
- Teams should prefer system consistency over local visual exceptions.
