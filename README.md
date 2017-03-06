# GroundHAR Day

GroundHAR Day is a tool for doing rapid, reproducible performance experiments.

Given an HTTP Archive - or [HAR][] - GroundHAR Day simulates the observed
network environment inside a Docker container. This makes it possible to replay
the captured page load under different network conditions. More interestingly,
the HAR content can be edited directly to quickly and rigorously evaluate
different optimization ideas.

## Quick start

### Prerequisites

* [VirtualBox][]
* [Vagrant][]

1. Provision the VM
  ```sh
  vagrant up
  ```
2. Upload a HAR to replay
  ```sh
  FIXME
  ```
3. Open http://localhost:9222 in your browser and click on "about:blank"
4. Type `http://lawnsea.com` into the headless browser's URL bar

[HAR]: http://www.softwareishard.com/blog/har-12-spec/
[Vagrant]: https://www.vagrantup.com/downloads.html
[VirtualBox]: https://www.virtualbox.org/wiki/Downloads
