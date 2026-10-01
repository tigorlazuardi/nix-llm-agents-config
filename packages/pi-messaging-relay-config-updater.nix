{
  coreutils,
  jq,
  lib,
  writeShellApplication,
}:
# Renders the pi-messaging-relay client config at the extension's fixed path
# (~/.config/pi/pi-messaging-relay.json): url required, secret optional and
# verbatim (no trimming, 1-512 bytes), file mode exactly 0600, regular
# non-symlink. The secret never enters the Nix store; it is read from the
# operator-owned file at activation time.
writeShellApplication {
  name = "pi-messaging-relay-config-update";
  runtimeInputs = [
    coreutils
    jq
  ];
  text = ''
    if (( $# < 2 )) || (( $# > 3 )); then
      echo "usage: pi-messaging-relay-config-update CONFIG URL [SECRET_FILE]" >&2
      exit 2
    fi

    config=$1
    url=$2
    secret_file=''${3:-}

    jq -ne --arg url "$url" '$url |
      test("^http://127\\.0\\.0\\.1(:[0-9]+)?/?$")
      or test("^http://\\[::1\\](:[0-9]+)?/?$")
      or test("^https://[^/@?#:]+(:[0-9]+)?/?$")' \
      >/dev/null || {
      echo "invalid relay client url (HTTP loopback or HTTPS origin only): $url" >&2
      exit 2
    }

    dir=$(dirname "$config")
    install -d -m 0700 -- "$dir"
    tmp=$(mktemp "$dir/.config.json.tmp.XXXXXX")
    trap 'rm -f -- "$tmp"' EXIT

    if [[ -n "$secret_file" ]]; then
      [[ -f "$secret_file" && ! -L "$secret_file" ]] || {
        echo "relay secret file must be a regular non-symlink file: $secret_file" >&2
        exit 2
      }
      bytes=$(wc -c < "$secret_file")
      (( bytes >= 1 && bytes <= 512 )) || {
        echo "relay secret must be 1-512 bytes, got $bytes: $secret_file" >&2
        exit 2
      }
      jq -n --arg url "$url" --rawfile secret "$secret_file" \
        '{ url: $url, secret: $secret }' > "$tmp"
    else
      jq -n --arg url "$url" '{ url: $url }' > "$tmp"
    fi

    total=$(wc -c < "$tmp")
    (( total <= 4096 )) || {
      echo "rendered relay client config exceeds 4096 bytes" >&2
      exit 1
    }

    if [[ -f "$config" && ! -L "$config" ]] && cmp -s "$tmp" "$config"; then
      chmod 0600 "$config"
      exit 0
    fi

    chmod 0600 "$tmp"
    mv -f -- "$tmp" "$config"
  '';

  meta = {
    description = "Render the pi-messaging-relay client config file with 0600 permissions";
    license = lib.licenses.mit;
    mainProgram = "pi-messaging-relay-config-update";
  };
}
