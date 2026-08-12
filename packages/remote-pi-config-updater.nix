{
  coreutils,
  jq,
  lib,
  nodejs_22,
  writeShellApplication,
}:
writeShellApplication {
  name = "remote-pi-config-update";
  runtimeInputs = [
    coreutils
    jq
    nodejs_22
  ];
  text = ''
    if (( $# != 2 )); then
      echo "usage: remote-pi-config-update CONFIG RELAY_URL" >&2
      exit 2
    fi

    config=$1
    relay=$(node -e '
      const url = new URL(process.argv[1]);
      if (url.protocol !== "http:" && url.protocol !== "https:") process.exit(2);
      process.stdout.write(url.toString());
    ' "$2") || {
      echo "invalid Remote Pi HTTP(S) relay URL: $2" >&2
      exit 2
    }

    dir=$(dirname "$config")
    install -d -m 0700 -- "$dir"
    tmp=$(mktemp "$dir/.config.json.tmp.XXXXXX")
    snapshot=$(mktemp "$dir/.config.json.snapshot.XXXXXX")
    trap 'rm -f -- "$tmp" "$snapshot"' EXIT

    if [[ -e "$config" ]]; then
      cp -- "$config" "$snapshot"
      jq -e 'type == "object"' "$snapshot" >/dev/null || {
        echo "remote-pi config must contain a JSON object: $config" >&2
        exit 1
      }
      jq --arg relay "$relay" '.relay = $relay' "$snapshot" > "$tmp"
      if cmp -s "$tmp" "$snapshot"; then
        chmod 0600 "$config"
        exit 0
      fi
      cmp -s "$config" "$snapshot" || {
        echo "remote-pi config changed concurrently; refusing to overwrite: $config" >&2
        exit 1
      }
    else
      jq -n --arg relay "$relay" '{ relay: $relay }' > "$tmp"
      [[ ! -e "$config" ]] || {
        echo "remote-pi config appeared concurrently; refusing to overwrite: $config" >&2
        exit 1
      }
    fi

    chmod 0600 "$tmp"
    mv -f -- "$tmp" "$config"
  '';

  meta = {
    description = "Safely merge a relay URL into mutable Remote Pi config";
    license = lib.licenses.mit;
    mainProgram = "remote-pi-config-update";
  };
}
