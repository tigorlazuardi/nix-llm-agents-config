# nixpkgs 1.5.0's pi-coding-agent postInstall copies a fixed list of workspace
# packages into the runtime node_modules tree, but it omits
# @earendil-works/pi-schema even though @earendil-works/pi-ai now imports it.
# Without it every check that loads the unbundled pi-ai (dev-journal, lazy-tools)
# fails with ERR_MODULE_NOT_FOUND, which blocks the input update. Copy the
# workspace package from the build tree the same way nixpkgs handles its peers.
final: prev:
let
  pkg = prev.pi-coding-agent;
in
{
  pi-coding-agent =
    if prev.lib.versionAtLeast pkg.version "1.5.0" then
      pkg.overrideAttrs (old: {
        postInstall = (old.postInstall or "") + ''
          local nm="$out/lib/node_modules/pi-monorepo/node_modules"
          if [ -d packages/schema ]; then
            rm -rf "$nm/@earendil-works/pi-schema"
            cp -r packages/schema "$nm/@earendil-works/pi-schema"
          fi
        '';
      })
    else
      pkg;
}
