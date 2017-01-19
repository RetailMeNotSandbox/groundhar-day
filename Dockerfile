#   Copyright 2016 IWASE Yusuke
#
#   Licensed under the Apache License, Version 2.0 (the "License");
#   you may not use this file except in compliance with the License.
#   You may obtain a copy of the License at
#
#       http://www.apache.org/licenses/LICENSE-2.0
#
#   Unless required by applicable law or agreed to in writing, software
#   distributed under the License is distributed on an "AS IS" BASIS,
#   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#   See the License for the specific language governing permissions and
#   limitations under the License.
#
#   Modifications are copyright 2017 RetailMeNot, Inc. and released under the
#   terms of the MIT License

FROM nodesource/xenial

RUN apt-get -y update && \
  apt-get -y install \
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
    wget

RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | \
  apt-key add -
RUN sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list'
RUN apt-get -y update && \
  apt-get install -y \
    google-chrome-unstable

COPY src/package.json /tmp/package.json
RUN cd /tmp && npm install
RUN mkdir -p /opt/src && \
  cp --recursive /tmp/node_modules /opt/src/

COPY ca /opt/ca/
RUN touch /opt/ca/index.txt && echo '1000' > /opt/ca/serial

COPY src /opt/src/

USER root
WORKDIR /opt/src
EXPOSE 9222

RUN mkdir -p /var/log/har

ENTRYPOINT ["/opt/src/ENTRYPOINT.sh"]
MAINTAINER Lon Ingram <lawnsea@gmail.com>
