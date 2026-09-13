# @gatekeeper-os/conformance

Runs against a **real** Gateway (never mocks of upstream — mocks hide drift). Each test exercises one dependency the OS has on
upstream (plan §8.3). Prints a verdict JSON consumed by `gkos update` step 5 and the nightly matrix.

```
pnpm conformance [--gateway ws://127.0.0.1:19100] [--token …] [--only a,b] [--verdict out.json]
```
Uses a deterministic test model provider (registered by `src/test-provider/`) that emits scripted tool calls, so most tests need
no paid model.
