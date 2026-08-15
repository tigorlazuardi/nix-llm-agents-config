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
    configPath=''${1:?usage: pi-vision-handoff-config-update CONFIG_PATH VISION_MODEL}
    visionModel=''${2:?usage: pi-vision-handoff-config-update CONFIG_PATH VISION_MODEL}
    mkdir -p "$(dirname "$configPath")"
    tmp=$(mktemp "$configPath.tmp.XXXXXX")
    trap 'rm -f "$tmp"' EXIT

    if [ -e "$configPath" ]; then
      jq -e --arg model "$visionModel" \
        'if type == "object" then .visionModel = $model else error("config must be a JSON object") end' \
        "$configPath" > "$tmp"
    else
      jq -n --arg model "$visionModel" '{visionModel: $model}' > "$tmp"
    fi

    chmod 600 "$tmp"
    mv "$tmp" "$configPath"
    trap - EXIT
  '';
}
