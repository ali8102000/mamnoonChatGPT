# Mamnoon screen parity gate

The Web app is the design and behavior source of truth. The manifest lists every public screen, every dedicated administration screen, and all 18 administration sections.

## Automated source gate

Run from `expo-app/`:

```sh
bun run test:parity
```

The gate checks:

- Every declared Web route and native route exists.
- All 18 Web administration section keys are represented in the parity manifest and have native screen coverage.
- Native administration navigation targets exist.
- The General Manager complaints inbox is read-only on both platforms.
- Governorate controls remain restricted to the Super Admin.
- Light and dark semantic color tokens are converted from the Web OKLCH source and compared to the Android palette.
- Tajawal font weights and the type scale are present on Android and Web.

The mobile CI runs this gate on every push and pull request. A failure blocks the mobile CI job.

## Pixel comparison gate

The screenshot comparator is deliberately strict and fails on missing captures. It compares every screen in every declared context and both themes.

1. Capture the Web and Android screen at the manifest viewport: **390 × 844 logical pixels**, RTL, Arabic Iraq locale, font scale 1, same theme, same role and same deterministic test data.
2. Disable animations and hide transient system UI consistently. Keep the same app state and scroll position.
3. Normalize screenshots to the same 390 × 844 PNG dimensions without stretching content.
4. Name each image using this exact pattern:

   `<screen-id>__<context>__<theme>.png`

5. Place Web images in one directory and Android images in another, then run:

```sh
bun run test:visual-parity -- --web-dir ./captures/web --android-dir ./captures/android
```

The default gate allows at most 1% of pixels to differ by more than 12 channel values. Missing images, dimension mismatches, unsupported PNG encodings, or a larger difference fail the run. Tighten the threshold for a release candidate; do not loosen it to hide a mismatch.

The manifest currently covers all customer, driver, worker, Super Admin, Admin and General Manager contexts listed per screen. The visual comparator does not claim a screen passed until both matching screenshots exist.

## Important limits

The source gate proves route coverage and design-token alignment; it cannot prove rendered geometry, text wrapping, image placement, animation quality, or that every control works against live data. Those require the pixel capture gate and role-based interaction runs on a real Android build. Do not report 100% visual/functional parity until every declared capture and interaction scenario passes.
