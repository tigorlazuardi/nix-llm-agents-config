{
  buildNpmPackage,
  lib,
  runCommand,
}:
let
  locks = import ./pi-plugin-lock.nix;
in
buildNpmPackage {
  pname = "pix-tools";
  version = "1.0.0";

  src = runCommand "pix-tools-source" { } ''
    mkdir -p $out
    cat > $out/package.json <<'EOF'
    {
      "name": "pix-tools",
      "version": "1.0.0",
      "private": true,
      "dependencies": {
        "@xynogen/pix-data": "${locks."pix-data".version}",
        "@xynogen/pix-footer": "${locks."pix-footer".version}",
        "@xynogen/pix-pretty": "${locks."pix-pretty".version}",
        "@xynogen/pix-read": "${locks."pix-read".version}",
        "@xynogen/pix-write": "${locks."pix-write".version}",
        "@xynogen/pix-edit": "${locks."pix-edit".version}",
        "@xynogen/pix-ls": "${locks."pix-ls".version}",
        "@xynogen/pix-find": "${locks."pix-find".version}",
        "@xynogen/pix-grep": "${locks."pix-grep".version}"
      }
    }
    EOF
  '';

  postPatch = ''
    cp ${./pix-tools-package-lock.json} package-lock.json
  '';

  postInstall = ''
    # ponytail: pix-footer 0.1.20 lacks responsive layout; drop patch when upstream wraps footer content.
    substituteInPlace "$out/lib/node_modules/pix-tools/node_modules/@xynogen/pix-footer/src/footer.ts" \
      --replace-fail \
        'import { truncateToWidth } from "@earendil-works/pi-tui";' \
        'import { wrapTextWithAnsi } from "@earendil-works/pi-tui";' \
      --replace-fail \
        'return [truncateToWidth(line, width)];' \
        'return wrapTextWithAnsi(line, width);'
  '';

  npmDepsHash = locks."pix-data".npmDepsHash;
  npmInstallFlags = [
    "--omit=dev"
    "--legacy-peer-deps"
  ];
  dontNpmBuild = true;
  dontNpmPrune = true;

  meta = {
    description = "Non-bash Pix tool renderers for Pi Coding Agent";
    homepage = "https://github.com/xynogen/pix-mono";
    license = lib.licenses.mit;
  };
}
