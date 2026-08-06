{
  buildNpmPackage,
  lib,
  runCommand,
}:
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
        "@xynogen/pix-data": "0.4.1",
        "@xynogen/pix-footer": "0.1.20",
        "@xynogen/pix-pretty": "1.8.1",
        "@xynogen/pix-read": "0.1.20",
        "@xynogen/pix-write": "0.1.19",
        "@xynogen/pix-edit": "0.1.21",
        "@xynogen/pix-ls": "0.1.20",
        "@xynogen/pix-find": "0.1.20",
        "@xynogen/pix-grep": "0.1.20"
      }
    }
    EOF
  '';

  postPatch = ''
    cp ${./pix-tools-package-lock.json} package-lock.json
  '';

  postInstall = ''
    # ponytail: pix-footer 0.1.20 has no layout config; drop patch when upstream supports two-line layout.
    substituteInPlace "$out/lib/node_modules/pix-tools/node_modules/@xynogen/pix-footer/src/footer.ts" \
      --replace-fail \
        'const line = `''${modePart}''${loc}''${markersPart}''${ctxPart}''${sep}''${model}''${otherPart}''${tokensPart}''${tpsPart}`;' \
        'const lines = [`''${modePart}''${loc}''${markersPart}''${ctxPart}''${sep}''${model}`, `''${otherPart}''${tokensPart}''${tpsPart}`.slice(sep.length)];' \
      --replace-fail \
        'return [truncateToWidth(line, width)];' \
        'return lines.map((line) => truncateToWidth(line, width));'
  '';

  npmDepsHash = "sha256-Frc+oO8xFXjFIIke5i4i1bAhNQ66HX4oHUxPfOhvcls=";
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
