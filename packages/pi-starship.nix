{
  buildNpmPackage,
  fetchurl,
  lib,
  nodejs,
}:
buildNpmPackage {
  pname = "pi-starship";
  version = "0.49.4";

  src = fetchurl {
    url = "https://registry.npmjs.org/@narumitw/pi-starship/-/pi-starship-0.49.4.tgz";
    hash = "sha256-HG0SidW5YQUqYQbUFTaWN20TavVOdifoOb6KGpbT5oU=";
  };

  postPatch = ''
    ${nodejs}/bin/node -e 'const fs=require("fs"),p=JSON.parse(fs.readFileSync("package.json"));delete p.devDependencies;fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")'
    cp ${./pi-starship-package-lock.json} package-lock.json
  '';

  npmDepsHash = "sha256-4ejCCLX25yGN6ZUmweCkq1UNoePLpBHmF6SAIuDVET8=";
  npmInstallFlags = [
    "--omit=dev"
    "--legacy-peer-deps"
  ];
  dontNpmBuild = true;
  dontNpmPrune = true;

  meta = {
    description = "Native Starship-style TOML statusline for Pi";
    homepage = "https://github.com/narumiruna/pi-extensions/tree/main/extensions/pi-starship";
    license = lib.licenses.mit;
  };
}
