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
  sudo su
  ../bin/groundhar-day
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

## Documentation

### VM

The VirtualBox VM is configured via environment variables in the shell where
`vagrant up` is run.

#### `GROUNDHAR_CPUS`

The number of virtual CPUs the VM should have. Defaults to 4.

#### `GROUNDHAR_DEVTOOLS_PORT`

The port on the host where the Chrome DevTools is exposed. Defaults to 9222.

#### `GROUNDHAR_MEMORY`

The amount of memory in megabytes to reserve for the VM. Defaults to 2048.

#### `GROUNDHAR_NETWORK_IP`

The IP address of the VM on the `groundhar-day` [VirtualBox internal network][].
Defaults to 192.168.42.1.

#### `GROUNDHAR_SERVER_PORT`

The port on the host where the GroundHAR Day server is exposed. Defaults to
9000.

[HAR]: http://www.softwareishard.com/blog/har-12-spec/
[Vagrant]: https://www.vagrantup.com/downloads.html
[VirtualBox]: https://www.virtualbox.org/wiki/Downloads
[VirtualBox internal network]: https://www.virtualbox.org/manual/ch06.html#network_internal
