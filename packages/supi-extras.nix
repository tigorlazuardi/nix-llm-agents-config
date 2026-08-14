{
  fetchurl,
  lib,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."supi-extras";
in
stdenvNoCC.mkDerivation {
  pname = "supi-extras";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };

  postPatch = ''
    # ponytail: native OSC 52 backend replaces clipboardy's 52-package display-server closure.
    cat > src/clipboard.ts <<'EOF'
    import { spawn } from "node:child_process";
    import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

    export async function copyToClipboard(
      text: string,
      _cwd: string,
      _pi: ExtensionAPI,
    ): Promise<boolean> {
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn("osc-copy", [], { stdio: ["pipe", "ignore", "ignore"] });
          child.once("error", reject);
          child.once("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error("osc-copy exited with status " + code));
          });
          child.stdin.end(text);
        });
        return true;
      } catch {
        return false;
      }
    }
    EOF
    substituteInPlace package.json \
      --replace-fail '    "clipboardy": "^5.3.1",' ""
    # ponytail: retain SuPi utilities while pix-footer owns sole footer; remove when upstream adds a footer toggle.
    substituteInPlace src/index.ts \
      --replace-fail 'import supiFooter from "./supi-footer.ts";' "" \
      --replace-fail '  supiFooter(pi);' ""
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/lib/node_modules/@mrclrchtr/supi-extras"
    cp -R . "$out/lib/node_modules/@mrclrchtr/supi-extras"
    runHook postInstall
  '';

  meta = {
    description = "Quality-of-life commands and UI helpers for Pi";
    homepage = "https://github.com/mrclrchtr/supi/tree/main/packages/supi-extras";
    license = lib.licenses.mit;
  };
}
