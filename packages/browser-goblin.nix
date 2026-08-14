{
  agent-browser,
  browserExecutable ? "${chromium}/bin/chromium",
  chromium,
  fetchurl,
  lib,
  runtimeShell,
  stdenvNoCC,
}:
let
  lock = (import ./pi-plugin-lock.nix)."browser-goblin";
in
stdenvNoCC.mkDerivation {
  pname = "browser-goblin";
  version = lock.version;

  src = fetchurl {
    url = lock.src;
    hash = lock.hash;
  };
  sourceRoot = "package";

  # ponytail: adapt browser-goblin to nixpkgs agent-browser 0.27; remove when upstream catches up.
  postPatch = ''
    substituteInPlace extensions/pi-browser/index.ts \
      --replace-fail \
        'if (params.restore !== false) args.push("--restore");' \
        'if (params.restore !== false) args.push("--session-name", session);' \
      --replace-fail \
        'return text.split("\n[stderr]")[0].split("\n").filter((line) => !line.startsWith("$")).join("\n").trim();' \
        'const payload = text.split("\n[stderr]")[0].split("\n").filter((line) => !line.startsWith("$")).join("\n").trim(); return payload === "(no output)" || payload === "No requests captured" ? "" : payload;' \
      --replace-fail \
        'const data = parsed.data;' \
        'const data = parsed.data; if (typeof data.report === "string") { const metrics = ["FCP", "LCP", "CLS", "TTFB"].flatMap((name) => { const value = data.report.match(new RegExp(`^\\s*''${name}\\s+([^\\n]+)`, "m"))?.[1]?.trim(); return value ? [`''${name} ''${value}`] : []; }); if (metrics.length) return metrics.join(" · "); }'
  '';

  dontBuild = true;

  installPhase = ''
    runHook preInstall

    root=$out/lib/node_modules/browser-goblin
    mkdir -p "$root" "$out/bin"
    cp -r . "$root"

    cat > "$out/bin/browser-goblin-agent-browser" <<'EOF'
    #!${runtimeShell}
    export AGENT_BROWSER_EXECUTABLE_PATH=${lib.escapeShellArg browserExecutable}
    exec ${lib.getExe agent-browser} "$@"
    EOF
    chmod +x "$out/bin/browser-goblin-agent-browser"

    substituteInPlace "$root/extensions/pi-browser/index.ts" \
      --replace-fail \
        'cachedAgentBrowserBin = "agent-browser";' \
        'cachedAgentBrowserBin = "'"$out"'/bin/browser-goblin-agent-browser";'

    runHook postInstall
  '';

  passthru.agentBrowserVersion = agent-browser.version;

  meta = {
    description = "Pi browser testing, debugging, and visual QA tools";
    homepage = "https://www.npmjs.com/package/browser-goblin";
    license = lib.licenses.mit;
  };
}
