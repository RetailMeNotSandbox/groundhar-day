# -*- mode: ruby -*-
# vi: set ft=ruby :

devtools_port = ENV['GROUNDHAR_DEVTOOLS_PORT'] || 9222
server_port = ENV['GROUNDHAR_SERVER_PORT'] || 9000
internal_network_ip = ENV['GROUNDHAR_NETWORK_IP'] || "192.168.42.1"
memory = ENV['GROUNDHAR_MEMORY'] || 2048
cpus = ENV['GROUNDHAR_CPUS'] || 4

Vagrant.configure("2") do |config|
  config.vm.box = "ubuntu/xenial64"

  config.vm.provider "virtualbox" do |v|
    v.memory = memory
    v.cpus = cpus
  end

  # forward port for Chrome devtools
  config.vm.network "forwarded_port", guest: 9222, host: devtools_port

  # forward port for GroundHAR Day server
  config.vm.network "forwarded_port", guest: 9000, host: server_port

  # Connect to the GroundHAR Day VirtualBox internal network
  config.vm.network "private_network",
    ip: internal_network_ip,
    virtualbox__intnet: "groundhar-day"

  # Mount GroundHAR Day code
  config.vm.synced_folder "./", "/opt/groundhar-day"
  #config.vm.synced_folder "./examples", "/opt/groundhar-day/examples"
  #config.vm.synced_folder "./src", "/opt/groundhar-day/src"
  #config.vm.synced_folder "./lib", "/opt/groundhar-day/lib"

  # Provision dependencies
  config.vm.provision "shell",
    path: "./vagrant/provision.sh"
  config.vm.provision "shell",
    inline: "cd /opt/groundhar-day && npm install"

  # Copy root CA certificate
  config.vm.provision "shell",
    inline: "chown -R ubuntu /opt"
  config.vm.provision "file",
    source: "./ca",
    destination: "/opt/ca"

  # Install root CA certificate
  config.vm.provision "shell",
    path: "./vagrant/install-root-certificate.sh"
end
