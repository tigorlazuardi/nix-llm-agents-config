{
  fetchzip,
}:
fetchzip {
  pname = "pi-vcc";
  version = "0.5.0";

  url = "https://github.com/sting8k/pi-vcc/archive/90f578f267f630ac50af6ce259b05d1b49c11dff.tar.gz";
  hash = "sha256-O7drHOWABCUioS45LtB61VjlnjsShr7tyra7sVZFdUQ=";
  postFetch = ''
    rm "$out/demo.gif"
  '';

  meta = {
    description = "Algorithmic conversation compactor for Pi";
    homepage = "https://github.com/sting8k/pi-vcc";
  };
}