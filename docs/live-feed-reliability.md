# Live feed reliability notes

## Camera deployment dependency

The repository's dashboard is static browser code; no verified same-origin camera API service or server-side secret store was found in this integration. The camera panel therefore stays **CONFIGURATION REQUIRED** until deployment injects `window.CLEARGLASS_CONFIG.cameraFeedUrl` pointing to an authorized HTTPS server-side integration. That integration must keep provider credentials server-side, return a JSON array, and include provider-supplied HTTPS image URLs for each usable camera. Do not point this setting at a public CORS proxy. Do not add API keys to this file, HTML, query strings in client-visible code, or logs.

The client intentionally does not synthesize snapshot URLs from camera IDs. A valid metadata response with no usable image URLs is shown as empty/unavailable, not as working feeds. Metadata success is not proof an image loaded; each image reports loading, loaded, or failed separately.

## Freshness policy

- OpenSky response timestamp: maximum age 5 minutes; per-aircraft position timestamp: maximum age 10 minutes; future-clock tolerance: 2 minutes. On failures, retained positions are labelled stale and cleared after 15 minutes from their source observation time. HTTP 429 honors a numeric `Retry-After` in seconds, otherwise retries after 2 minutes.
- IESO observations: maximum age 15 minutes; future-clock tolerance 2 minutes. The parser requires a source timestamp and non-negative finite generation measurements. Because the two IESO documents may represent different semantics or observation times, each is validated independently and only one document's totals are used per render. If neither can be validated, prior validated values are marked stale; only when no validated observation exists is the static estimate shown.
- Camera metadata: no freshness claim is inferred from the request time. The UI displays the last successful metadata fetch separately; image-load success is not presented as a capture timestamp.
- Existing polling intervals remain unchanged. These thresholds are conservative client display policies, not provider SLAs.

## Validation limits

This repository uses a static frontend for this dashboard and has no root `package.json` or dedicated root test runner. JavaScript syntax was checked with the available JavaScript parser. Browser image loading, actual Ontario 511 credentials/provider terms, cross-origin access to IESO, and live-source timestamp semantics still require deployment/browser validation. Do not approve release based on syntax validation alone.
