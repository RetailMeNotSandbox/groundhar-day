#!/usr/bin/env bash

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

chmod -R o+rw /tmp/mnt

# remove default route
ip route delete default

# install root cert
mkdir -p $HOME/.pki/nssdb
touch password
certutil -d $HOME/.pki/nssdb -N -f password
rm password
certutil -d sql:$HOME/.pki/nssdb -A -t C -n groundhar-day \
  -i /opt/ca/certs/ca.cert.pem
cp /opt/ca/certs/ca.cert.pem \
  /usr/local/share/ca-certificates/groundhar-day.ca.cert.crt
update-ca-certificates

service openvswitch-switch start
ovs-vsctl set-manager ptcp:6640

bash

service openvswitch-switch stop
modprobe -r openvswitch
