# Portal Visual Jury Harness

Generic QA harness used only by Render to validate an external Preview URL.

No Portal source code, credentials, tokens, or target URLs are committed here.
Those values are supplied only through Render environment variables.

The harness checks four viewports (390x844, 430x932, 820x1180, 1440x900),
captures hero/map/full-page screenshots, and verifies the single-globe → map
contract.
