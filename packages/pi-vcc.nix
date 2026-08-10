{
  fetchzip,
}:
fetchzip {
  pname = "pi-vcc";
  version = "0.6.0";

  url = "https://github.com/sting8k/pi-vcc/archive/09c4a74c070aa5cbe0561adc8f04205dfb093984.tar.gz";
  hash = "sha256-klwPnZCTMrDF/ZYHG8u+qLwG0br0I8UPO/geirJU8s0=";
  postFetch = ''
    rm "$out/demo.gif"
  '';

  meta = {
    description = "Algorithmic conversation compactor for Pi";
    homepage = "https://github.com/sting8k/pi-vcc";
  };
}