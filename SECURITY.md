# Security

Dissect builds static HTML pages and runs locally. The kit makes no network requests; built pages load nothing from the network (the runtime and the model are inlined). The check scripts start a local headless Chrome with a temporary profile, talk to it over its local debugging port, and delete the profile when they finish.

Model files are JavaScript modules that `scripts/build.mjs` imports and runs: build only models you trust, as you would run any script.

To report a vulnerability, open a private security advisory on the repository (Security, then "Report a vulnerability"), with what you found and how to reproduce it. You will get an answer within a week.
