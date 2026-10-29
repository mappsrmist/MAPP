# MAPP visual system

Applied using UI UX Pro Max. Product: university administration portal; stack: Next.js 16, React 19, Tailwind 4.

## Direction
A restrained institutional interface shared by Student, Faculty, Admin, sign-in, and account setup. Existing workflows remain intact.

## Brand
Use the supplied original PNG assets in public/brand, uncropped and at their native aspect ratios, on neutral white plates in both themes. Favicon and Apple touch icon use the SRM crest from that supplied asset. InstitutionHeader owns the common masthead.

## Tokens
Light: soft grey-green background #f5f8f7, white cards, charcoal-green text #203c37, muted text #526b65, deep teal primary #35665e. Dark: green-charcoal background #101c19, cards #182722, soft foreground #e7f0eb, muted text #afc4b9, mint primary #95cdb6. Input borders use #80988c on white and #688477 in dark mode for at least 3:1 contrast. Typography: existing Geist sans; Geist mono only for identifiers.

## Components
Shared Card, PageHeader, Button, Input, Select, Dialog, and PagedTable provide uniform spacing, borders, focus, and responsive behaviour. Use a 4/8px spacing rhythm, 16px card corners, 44px standard controls, minimal shadows. Statuses retain text labels as well as colour.

## Navigation
All portal roles use PortalShell with the same institutional masthead, navigation rail, workspace account controls, and footer. Mobile uses an accessible Radix dialog drawer with focus trapping and Escape dismissal. Skip-to-content works across app pages. Tables scroll within their own labelled, keyboard-focusable regions.

## Skill guidance adapted to the existing app
The verified Minimalism & Swiss Style recommendation fits an administrative dashboard. Generated hero/CTA and portfolio layout suggestions did not fit this product and were excluded. Preserve the existing teal and sans-serif brief rather than adopt unrelated marketing layouts or ornamental typography.

## Validation
Inspect light/dark modes and 375, 768, 1024, and 1440px widths, landscape, larger text and reduced motion. Check logo proportions, focus visibility, touch targets, mobile drawer, table overflow, login interactions, and favicon identity. Authentication and allocation rules remain server-enforced.
