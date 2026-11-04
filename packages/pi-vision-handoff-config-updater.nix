{
  coreutils,
  jq,
  writeShellApplication,
}:
writeShellApplication {
  name = "pi-vision-handoff-config-update";
  runtimeInputs = [
    coreutils
    jq
  ];
  text = ''
    configPath=''${1:?usage: pi-vision-handoff-config-update CONFIG_PATH VISION_MODEL [FALLBACK_MODEL...]}
    visionModel=''${2:?usage: pi-vision-handoff-config-update CONFIG_PATH VISION_MODEL [FALLBACK_MODEL...]}
    shift 2

    # Remaining args are the fallback chain, in priority order.
    if [ "$#" -gt 0 ]; then
      fallbackModels=$(printf '%s\n' "$@" | jq -R . | jq -s -c .)
    else
      fallbackModels='[]'
    fi

    mkdir -p "$(dirname "$configPath")"
    tmp=$(mktemp "$configPath.tmp.XXXXXX")
    trap 'rm -f "$tmp"' EXIT

    if [ -e "$configPath" ]; then
      jq -e --arg model "$visionModel" --argjson fallbacks "$fallbackModels" \
        'if type == "object" then .visionModel = $model | .fallbackModels = $fallbacks else error("config must be a JSON object") end' \
        "$configPath" > "$tmp"
    else
      jq -n --arg model "$visionModel" --argjson fallbacks "$fallbackModels" \
        '{visionModel: $model, fallbackModels: $fallbacks}' > "$tmp"
    fi

    chmod 600 "$tmp"
    mv "$tmp" "$configPath"
    trap - EXIT
  '';
}
