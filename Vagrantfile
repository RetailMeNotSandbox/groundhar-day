# -*- mode: ruby -*-
# vi: set ft=ruby :

Vagrant.configure("2") do |config|
  config.vm.box = "ubuntu/xenial64"

  # Create a forwarded port mapping which allows access to a specific port
  # within the machine from a port on the host machine. In the example below,
  # accessing "localhost:8080" will access port 80 on the guest machine.
  config.vm.network "forwarded_port", guest: 9222, host: 9222

  # Connect to the GroundHAR Day VirtualBox internal network
  config.vm.network "private_network",
    ip: "192.168.42.1",
    virtualbox__intnet: "groundhar-day"

  # Mount GroundHAR Day code
  config.vm.synced_folder "./examples", "/opt/examples"
  config.vm.synced_folder "./src", "/opt/src"

  # Provision dependencies
  config.vm.provision "shell",
    path: "./vagrant/provision.sh"
  config.vm.provision "shell",
    inline: "cd /opt/src && npm install"

  # Copy root CA certificate
  config.vm.provision "shell",
    inline: "chown -R ubuntu /opt"
  config.vm.provision "file",
    source: "./ca",
    destination: "/opt/ca"

  # Install root CA certificate
  config.vm.provision "shell",
    path: "./vagrant/install-root-certificate.sh"

  # Mount examples
  config.vm.synced_folder "~/Projects/har/mnt", "/tmp/mnt"
end
