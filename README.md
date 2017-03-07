# GroundHAR Day

GroundHAR Day is a tool for doing rapid, reproducible performance experiments.

Given an HTTP Archive - or [HAR][] - GroundHAR Day simulates the observed
network environment inside a VirtualBox VM. This makes it possible to replay the
captured page load under different network conditions. More interestingly, the
HAR content can be edited directly to quickly and rigorously evaluate different
optimization ideas.

## Quick start

### Prerequisites

* [VirtualBox][]
* [Vagrant][]

1. Provision the VM

  ```sh
  vagrant up
  ```

2. Start the GroundHAR Day server

  ```sh
  vagrant ssh
  # then, from the Vagrant ssh session:
  cd /opt/groundhar-day/src
  sudo ../bin/groundhar-day
  ```

3. Upload a HAR to replay

  ```sh
  curl -H "Content-Type: application/json" --data-binary @./examples/lawnsea.com.har -X PUT http://localhost:9000/har
  ```

4. Open [http://localhost:9222](http://localhost:9222) in your browser and click on "about:blank"
5. Type `http://lawnsea.com` into the headless browser's URL bar
6. Reset the simulation for another replay

  ```sh
  curl http://localhost:9000/reset
  ```

[HAR]: http://www.softwareishard.com/blog/har-12-spec/
[Vagrant]: https://www.vagrantup.com/downloads.html
[VirtualBox]: https://www.virtualbox.org/wiki/Downloads
