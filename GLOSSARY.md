# Nix LLM Agents Configuration

Home Manager configuration that makes coding-agent configuration portable while keeping runtime-owned data local.

## Language

**Managed configuration**:
Portable Pi configuration owned declaratively by Home Manager. Native `programs.pi-coding-agent` options own supported values; this repository links only unsupported resources.
_Avoid_: Pi state, full directory ownership

**Runtime state**:
Machine-local mutable Pi data such as authentication, sessions, logs, caches, trust data, and generated package-manager state.
_Avoid_: Managed configuration, secrets

**Runtime secret reference**:
A provider-to-file-path mapping resolved by Pi at request time. Secret content remains outside Git, evaluation output, generated configuration, and the Nix store.
_Avoid_: API key, encrypted repository secret

**Primed platform**:
A platform the module is designed not to exclude but does not currently validate.
_Avoid_: Supported platform, validated platform

**Validated platform**:
A platform covered by runnable module, package-loading, and managed-output checks.
_Avoid_: Primed platform, assumed-compatible platform

**Pi plugin registry**:
The repository manifest of third-party Pi packages, their exact source identity, version or revision, and reproducible Nix hashes.
_Avoid_: Pi runtime manifest, mutable package list

**Bundled plugin closure**:
One immutable plugin or local-extension output containing every runtime and peer dependency it needs.
_Avoid_: Shared user `node_modules`, injected global peer

**Update report**:
The GitHub Actions step summary containing dependency changes, checks, unchanged entries, and failures for one scheduled run.
_Avoid_: Telemetry backend, release report
