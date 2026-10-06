# Accessibility, privacy and design rules

What the app and the website are held to, how each is checked, and what is still open.

## Accessibility

**Target: WCAG 2.2 level AA.** Ghana's Persons with Disability Act, 2006 (Act 715) protects the right of
disabled people to take part in public life, but it does not name a technical web standard, and no
Ghana-specific web accessibility standard was found. WCAG 2.2 AA is the standard the rest of the world's
accessibility law points at, so it is the one used here.

How it is checked:

- **axe-core** (WCAG 2.0, 2.1, 2.2 A and AA, plus best practice) in a real browser, over every public page, the
  member pages, and the finance, shepherding, chapter admin, admin and national portals; phone and desktop; light and dark.
- **Colour pairs**: every text colour and its background is chosen at 4.5:1 or better; status colours come in
  ink and background pairs (`--ok-ink` on `--ok-bg`, and so on).
- **Keyboard**: a skip link on every page, visible focus ring (`--focus`, 3px), tables that scroll can be focused,
  every control has a name, field errors move focus to the field.
- **Targets**: buttons and links are at least 44px tall.
- **Motion**: nothing moves on scroll, nothing floats, and `prefers-reduced-motion` removes what is left.

Not covered by the automated checks and still to be done by a person: a screen reader pass (TalkBack on Android is the
one most students will have), and a read-through of the admin panels with a keyboard only.

## Privacy

- No analytics, advertising or tracking. Fonts, scripts and pictures are served from the app or site itself.
- One strictly necessary session cookie, set only after sign-in. The website sets none. See `public/cookies.html` and
  `site/cookies.html`. Because nothing needs consent, there is no cookie banner.
- YouTube and Facebook videos load only after the person presses the button on them.
- Registration records that the person agreed to the Terms and Privacy policy, when, and which wording
  (`consentedAt`, `consentVersion`; the version lives in `server.js` as `POLICY_VERSION`). Change it when either page changes
  in a way that matters.
- Forms that collect something personal say what it is used for beside the button.
- Content-Security-Policy and Permissions-Policy are set in `lib/securityHeaders.js`. The app's pages still use inline scripts and
  styles, so `'unsafe-inline'` is in the policy; moving them to files and using nonces is the next step.

## Design rules

No gradients, pill buttons, emoji icons, decorative labels above headings, scroll or floating animation, cursor effects,
em dashes in copy, or invented numbers and reviews. Motion is limited to a 0.97 press scale and short fades (150ms or less,
ease-out); hover styles apply only where a pointer exists. Loading is shown with grey blocks, not the word "Loading".
Colours that mean something have names (`ok`, `warn`, `bad`, `info`). The font pair is Source Serif 4 and Source Sans 3.

`npx impeccable detect` and the test suite (`npm test`) both enforce parts of this.
