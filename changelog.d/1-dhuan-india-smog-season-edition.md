- Dhuan (धुआँ), the India smog-season edition of God's Eye View. The Air
  quality layer gains a second provider: CPCB's hourly stations via data.gov.in
  (`CPCB_API_KEY`, server-side `/api/cpcb` proxy, 20-minute cache, serve-stale),
  with India's six NAQI bands and colours, CPCB's validity rule (three pollutants,
  one particulate) and the dominant pollutant on the card. Providers now own
  their band scale, stale line and key requirement; the layer takes all three
  from the source it is given, so ECCC is unchanged. `src/edition.js` holds the
  edition policy: the default provider, a Punjab startup view, a Punjab + Haryana
  fire counter on the FIRMS row and the HUD summary line (with the morning-pass
  caveat), the built-in "Smog Season Live" Director scene (also shipped as
  `scenes/smog-season-live.json`), and five layers kept out of the catalog —
  military flights, military awareness, military installations, CCTV and ALPR —
  which stay registered for the token ledger but are hidden from the panel,
  skipped by voice and refused by the layer manager (Sattyam Jain).
- Dhuan's own chrome. The edition retires the classification HUD and the
  circular scope mask outright (`IntelHUD` `available: false`,
  `setScopeMaskAvailable(false)`: share links, presets and scene playback
  cannot bring them back, and their DISPLAY groups are hidden), hides the sensor
  presets and the voice dock, and replaces them with a calm briefing: a Devanagari
  wordmark, a story strip under it with the live Punjab + Haryana fire count,
  Delhi NCR's worst station with its NAQI band in words, the time the numbers
  were taken, and one button that plays "Smog Season Live" once. The Layers
  panel opens by default, grouped story-first (`EDITION.panelGroups`) with one
  Material glyph per row (`EDITION.layerGlyphs`); the welcome dialog offers
  "Smog season live" (fires, air quality, wind, camera stays over Punjab) or a
  clean globe; the dock is a single place search whose quick places are Delhi, Chandigarh,
  Ludhiana, Amritsar and Lucknow (`src/dhuan/cities.js`); the Data keys dialog
  lists only the five providers the edition's layers use (`EDITION.keyIds`);
  the scene no longer asks for Google's photoreal tiles, so it plays keyless.
  The smog mission opens once any story feed answers (a slow CPCB shows at
  its row instead of holding the welcome shut), the CPCB proxy warms its cache
  at boot and waits 45 s per page, and the browser source waits 40 s.
  All of it lives in `src/ui/styles/dhuan.css`
  (tokens scoped to `html[data-edition="dhuan"]`) and `src/dhuan/storyStrip.js`;
  upstream sheets are untouched (Sattyam Jain).
