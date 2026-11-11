{
  fetchurl,
  lib,
  nodejs,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."pi-herdr-agents";
in
stdenvNoCC.mkDerivation {
  pname = "pi-herdr-agents";
  version = lock.version;

  # The registry pins the compressed tarball (lock.src/lock.hash); stdenv
  # unpacks it before the build phases run.
  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  # Child launches export PI_RELAY_ANNOTATIONS (subagent/parent/name/role labels only) so
  # pi-messaging-relay peers can be told apart (tigorlazuardi/pi-messaging-relay#84).
  # Fails the build loudly if upstream changes the patched hunk.
  patches = [ ./pi-herdr-agents-relay-annotations.patch ];

  # ponytail: Pi 1.0+ provides extension peers; the package ships no runtime
  # dependencies, so strip the declared dev/peer closures instead of installing
  # them (no npm install, no vendored copies).
  postPatch = ''
    ${nodejs}/bin/node -e 'const fs = require("fs"); const p = require("./package.json"); delete p.devDependencies; delete p.peerDependencies; fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n")'
    rm -rf node_modules

    # ponytail: prompt-level cleanup only; upstream (ADR-0011) rejects auto-reap.
    # --replace-fail breaks the build loudly if upstream rewrites this sentence.
    substituteInPlace pi-extension/subagents/launch-tools.ts \
      --replace-fail \
        'they are not pushed, merged, or removed automatically. ' \
        'they are not pushed, merged, or removed automatically. Once you have reviewed the result and it is merged, committed or no longer needed, and the child has finished, call worktree_remove for that worktree so it leaves Herdr (branch and commits are kept; use preserve: true only for dirty work to keep). Never leave finished worktrees behind. '
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/pi-herdr-agents"
    cp -R . "$out/lib/node_modules/pi-herdr-agents/"
    runHook postInstall
  '';

  meta = {
    description = "Async Pi subagents in Herdr, with optional isolated Git worktrees";
    homepage = "https://github.com/giuseppecrj/pi-herdr-agents";
    license = lib.licenses.mit;
  };
}
