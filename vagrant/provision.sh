#!/usr/bin/env bash

curl -sL https://deb.nodesource.com/setup_6.x | sudo -E bash -
apt-get -y update
apt-get install -y \
  build-essential \
  libssl-dev \
  software-properties-common \
  curl \
  iproute2 \
  iptables \
  iputils-ping \
  net-tools \
  tcpdump \
  dnsmasq \
  dnsutils \
  libnss3-tools \
  mininet \
  vim \
  wget \
  nodejs

# Install Chrome
wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | \
  apt-key add -
sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list'
apt-get -y update
apt-get install -y \
  google-chrome-unstable
