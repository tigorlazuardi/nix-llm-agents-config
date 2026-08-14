---
paths: "pi-plugins.json"
---
Treat this file only as Pi plugin lock/update registry. Runnable plugin gets lock metadata even when installation or updates require manual review; manual review never blocks locking it. `strategy` describes automation support only.

Use optional `notes` only for retrospective issue context. Each note records `issue` and `resolveStrategy`; notes never affect lock validity or updater behavior.
