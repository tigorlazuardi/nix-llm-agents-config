{
  browserExecutable ? "${chromium}/bin/chromium",
  buildNpmPackage,
  chromium,
  fetchurl,
  lib,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-playwright";
in
buildNpmPackage {
  pname = "pi-playwright";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  # ponytail: use configured browser executable; switch to Playwright-pinned browsers if path support breaks.
  postPatch = ''
    cp ${./pi-playwright-package-lock.json} package-lock.json
    substituteInPlace skills/playwright-browser/scripts/lib/runtime.js \
      --replace-fail \
        'env: { ...process.env, ...(options.env || {}) },' \
        'env: { PLAYWRIGHT_MCP_EXECUTABLE_PATH: ${builtins.toJSON browserExecutable}, ...process.env, ...(options.env || {}) },'
  '';

  npmDepsHash = lock.npmDepsHash;
  npmInstallFlags = [ "--omit=dev" ];
  dontNpmBuild = true;

  meta = {
    description = "Playwright browser automation skill package for Pi";
    homepage = "https://www.npmjs.com/package/pi-playwright";
    license = lib.licenses.mit;
  };
}
