#!/usr/bin/env bash

mkdir -p $HOME/.pki/nssdb
touch password
certutil -d $HOME/.pki/nssdb -N -f password
rm password
certutil -d sql:$HOME/.pki/nssdb -A -t C -n groundhar-day \
  -i /opt/ca/certs/ca.cert.pem
cp /opt/ca/certs/ca.cert.pem \
  /usr/local/share/ca-certificates/groundhar-day.ca.cert.crt
update-ca-certificates
