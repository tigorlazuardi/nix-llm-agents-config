{
  fetchzip,
}:
fetchzip {
  pname = "pi-vcc";
  version = "0.4.0";

  url = "https://github.com/sting8k/pi-vcc/archive/b9e0babee26732e2dca90b7d5cb2873a5e9bfad9.tar.gz";
  hash = "sha256-En+wBXK/pe5FNnTAPkySDDGEGTvBZx3FNx5O+Z7aLfM=";
  postFetch = ''
    rm "$out/demo.gif"
  '';

  meta = {
    description = "Algorithmic conversation compactor for Pi";
    homepage = "https://github.com/sting8k/pi-vcc";
  };
}
