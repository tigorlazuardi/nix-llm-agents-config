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

  npmDepsHash = "sha256-UluEWs3Ui0aGs0tAP4xMDTzqc47sf8J+z8W+r9DKyX4=";
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
