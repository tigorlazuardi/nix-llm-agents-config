{
  buildNpmPackage,
  fetchurl,
  lib,
  nodejs,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-rules";
in
buildNpmPackage {
  pname = "pi-rules";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  # ponytail: omit build-only and host Pi packages; offline load check proves peer resolution.
  # Pi 1.0+ provides typebox root and /compile specifiers; 0.6.0 still imports
  # Schema.Compile from the non-aliased /schema subpath, so rewrite dist to the
  # host-aliased compile entry until upstream release moves to peerDependencies.
  postPatch = ''
    cp ${./pi-rules-package-lock.json} package-lock.json
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.devDependencies; delete p.peerDependencies; p.dependencies = { picomatch: "4.0.5", yaml: "2.9.0" }; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
    ${nodejs}/bin/node -e 'const fs = require("fs"); const f = "dist/discovery.js"; const s = fs.readFileSync(f, "utf8"); if (!s.includes(String.raw`import Schema from "typebox/schema"`)) throw new Error("pi-rules dist import drift"); fs.writeFileSync(f, s.replace(String.raw`import Schema from "typebox/schema"`, String.raw`import { Compile } from "typebox/compile"`).replaceAll("Schema.Compile(", "Compile("))'
  '';

  npmDepsHash = lock.npmDepsHash;
  npmInstallFlags = [
    "--omit=dev"
    "--omit=peer"
  ];
  npmPackFlags = [ "--ignore-scripts" ];
  dontNpmBuild = true;

  meta = {
    description = "Claude-compatible project rules for Pi agents and subagents";
    homepage = "https://github.com/tigorlazuardi/pi-rules";
    license = lib.licenses.mit;
  };
}
