{
  buildNpmPackage,
  chromium,
  fetchurl,
  lib,
}:
buildNpmPackage {
  pname = "pi-playwright";
  version = "0.1.1";

  src = fetchurl {
    url = "https://registry.npmjs.org/pi-playwright/-/pi-playwright-0.1.1.tgz";
    hash = "sha256-lnpyJk49fxSNBSTJAflPFFvGRpVPu9U4DaTTDlnzwP4=";
  };

  # ponytail: use Nix Chromium; switch to Playwright-pinned browsers if executable-path support breaks.
  postPatch = ''
    cp ${./pi-playwright-package-lock.json} package-lock.json
    substituteInPlace skills/playwright-browser/scripts/lib/runtime.js \
      --replace-fail \
        'env: { ...process.env, ...(options.env || {}) },' \
        'env: { PLAYWRIGHT_MCP_EXECUTABLE_PATH: "${chromium}/bin/chromium", ...process.env, ...(options.env || {}) },'
  '';

  npmDepsHash = "sha256-6prPdkhNL+NtFKtd0gjLtfXyV8GCNshxhZlGskQHIvI=";
  npmInstallFlags = [ "--omit=dev" ];
  dontNpmBuild = true;

  meta = {
    description = "Playwright browser automation skill package for Pi";
    homepage = "https://www.npmjs.com/package/pi-playwright";
    license = lib.licenses.mit;
  };
}
