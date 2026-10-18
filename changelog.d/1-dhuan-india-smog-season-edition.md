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
