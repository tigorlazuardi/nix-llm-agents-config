{
  fetchurl,
  lib,
  nodejs,
  runCommand,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-vimmode";
  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };
  # 0.9.0 is a single minified bundle. `Uh` is the extension's default export
  # (its activation entry, `function Uh(e){Hh(e)}`); children need no vim
  # editing, and insert mode swallows the first Escape that 3.7.2's upstream
  # single-Escape interrupt relies on.
  activateAnchor = "function Uh(e){Hh(e)}";
in
runCommand "pi-vimmode-${lock.version}"
  {
    meta = {
      description = "Vim-style prompt editing for Pi";
      homepage = "https://github.com/pekochan069/pi-vimmode";
      license = lib.licenses.mit;
    };
  }
  ''
    package="$out/lib/node_modules/pi-vimmode"
    mkdir -p "$package"
    tar -xzf ${src} --strip-components=1 -C "$package"

    # The bundle is edited as text (UTF-8 round-trip, never assumed ASCII).
    # ponytail: minified-anchor patch; replace with an upstream runtime opt-out
    # if pi-vimmode ever ships one.
    ${nodejs}/bin/node -e '
      const fs = require("fs");
      const file = process.argv[1];
      const anchor = process.argv[2];
      const source = fs.readFileSync(file, "utf8");
      if (source.split(anchor).length !== 2) {
        console.error(
          "pi-vimmode: activation anchor " + JSON.stringify(anchor) +
            " not found exactly once in " + file +
            "; the bundle changed. Re-derive the anchor before building."
        );
        process.exit(1);
      }
      fs.writeFileSync(
        file,
        source.replace(anchor, "function Uh(e){if(process.env.PI_SUBAGENT_ID)return;Hh(e)}")
      );
    ' "$package/index.js" ${lib.escapeShellArg activateAnchor}
  ''
