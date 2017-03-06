'use strict';

const child_process = require('child_process');
const express = require('express');
const fs = require('fs');
const mkdirp = require('mkdirp');
const nodeCleanup = require('node-cleanup');
const rimraf = require('rimraf');
const stringToStream = require('string-to-stream');
const url = require('url');

const servers = new Set;
nodeCleanup((exitCode, signal) => {
  for (let server of servers) {
    try {
      server.kill();
    } catch (e) {
      console.error(`Could not kill ${server}: ${e}`);
    }
  }
});

const {
    createNamespace,
    execInNamespace,
    createVethPair
  } = require('./util');


function Environment(har) {
  this._har = har;
  this._hosts = new Map();
  this._ipsByOrigin = new Map();
  this._originsByIp = new Map();
  this._servers = new Map();

  har.log.entries.forEach(entry => {
    const serverIp = entry.serverIPAddress;
    const entryUrl = url.parse(entry.request.url);

    if (serverIp === '') {
      return;
    }

    const port = entryUrl.port ||
      entryUrl.protocol === 'https:' ? '443' : '80';
    const origin = `${entryUrl.protocol}//${entryUrl.hostname}:${port}`;

    const ipServer = this._servers.get(serverIp);
    const originServer = this._servers.get(origin);

    if (!ipServer && !originServer) {
      // no server exists for this ip/origin pair, create one
      const server = {
        ips: new Set([serverIp]),
        origins: new Set([origin])
      };
      this._servers.set(serverIp, server);
      this._servers.set(origin, server);
    } else if (ipServer === originServer) {
      // we already have a server for this ip/origin pair
      return;
    } else if (!ipServer) {
      // new ip for this origin
      originServer.ips.add(serverIp);
      this._servers.set(serverIp, originServer);
    } else if (!originServer) {
      // new origin for this ip
      ipServer.origins.add(origin);
      this._servers.set(origin, ipServer);
    } else {
      // different servers exist for this origin and ip, so merge them by moving
      // all of the origins and ips from the origin server into the ip server
      for (let ip of originServer.ips) {
        ipServer.ips.add(ip);
        this._server.set(ip, ipServer);
      }

      for (let origin of originServer.origins) {
        ipServer.origins.add(origin);
        this._server.set(origin, ipServer);
      }
    }

    // map domain -> ip for building hosts file
    if (!this._hosts.has(entryUrl.hostname)) {
      // map domains to the set of IPs they name
      this._hosts.set(entryUrl.hostname, new Set());
    }
    this._hosts.get(entryUrl.hostname).add(serverIp);

    if (!this._ipsByOrigin.has(origin)) {
      this._ipsByOrigin.set(origin, new Set());
    }
    this._ipsByOrigin.get(origin).add(serverIp);

    if (!this._originsByIp.has(serverIp)) {
      this._originsByIp.set(serverIp, new Set());
    }
    this._originsByIp.get(serverIp).add(origin)
  });

  console.log(this._hosts);
  console.log(this._ipsByOrigin);
  console.log(this._originsByIp);
  console.log(this._servers);
}

function createHost(namespace, host, ip, hostCmd) {
  createVethPair(namespace, host);
  [
    `ifconfig ${host}-cl ${ip} up`,
    `ip link set ${host}-net up`,
    `ip link set ${host}-net master ghd-br`
  ].forEach(cmd => execInNamespace(namespace, cmd));

  hostCmd = `ip netns exec ${namespace} ${hostCmd}`;
  const hostCmdParts = hostCmd.split(' ');
  console.log(hostCmd);
  console.log(`spawning ${hostCmdParts[0]} ${hostCmdParts.slice(1)}`);
  const child = child_process.spawn(hostCmdParts[0], hostCmdParts.slice(1));
  servers.add(child);

  child.stdout.on('data', (data) => {
      console.log(`stdout: ${data}`);
  });

  child.stderr.on('data', (data) => {
    console.log(`stderr: ${data}`);
  });

  child.on('close', (code) => {
    console.log(`child child exited with code ${code}`);
  });

  child.on('error', err => {
    console.error(`Host error: ${err}`);
    process.exit(1);
  });
}

/**
 * Given a HAR, create an environment that simulates the network observed when
 * the HAR was captured and allows it to be replayed.
 */
Environment.prototype.initialize = function () {
  const hosts =
    Array.from(this._hosts).reduce((hosts, entry) => {
      const [host, ips] = entry;

      console.log(ips, host);
      Array.from(ips).forEach(hostIp => {
        console.log(`${hostIp}\t${host}`);
        hosts.push(`${hostIp}\t${host}`);
      });

      return hosts;
    }, ['192.168.2.2\tgroundhar-day.local']).join('\n') +'\n';

  // FIXME: this should be configurable
  const resolvConf = 'nameserver 192.168.1.100\n'

  // create the client and net namespaces
  createNamespace('ghd-net', {
    etc: {
      hosts,
      'resolv.conf': resolvConf
    }
  });

  // create veth pair and link namespaces
  // - move one
  createVethPair('ghd-cl', 'ghd');
  execInNamespace('ghd-cl', 'ip link set ghd-net netns ghd-net');

  // - traffic shape
  [
    'tc qdisc add dev ghd-cl root handle 5:0 htb default 1',
    'tc class add dev ghd-cl parent 5:0 classid 5:1 htb rate 1.600000Mbit burst 15k',
    'tc qdisc add dev ghd-cl  parent 5:1  handle 10: netem delay 150ms 0ms loss 0',
    // - set one that wasn't moved as default gateway
    'ifconfig ghd-cl 192.168.1.1/24 up',
    'ip route add default via 192.168.1.1'
  ].forEach(cmd => execInNamespace('ghd-cl', cmd));

  // - create bridge and connect veth that was moved
  [
    'ip link add ghd-br type bridge',
    'ip link set ghd-br up',
    'ip link set ghd-net up',
    'ip link set ghd-net master ghd-br',
  ].forEach(cmd => execInNamespace('ghd-net', cmd));

  // - spin up dns
  createHost(
    'ghd-net',
    'dns',
    '192.168.1.100/24',
    'dnsmasq -k -i dns-cl -a 192.168.1.100 -R -h -H /etc/hosts --log-facility=/var/log/groundhar-day/dns'
  );

  // reset state of CA
  rimraf.sync('/opt/ca/server-store');
  mkdirp.sync('/opt/ca/server-store');
  rimraf.sync('/opt/ca/newcerts');
  mkdirp.sync('/opt/ca/newcerts');
  fs.writeFileSync('/opt/ca/index.txt', '');
  fs.writeFileSync('/opt/ca/serial', '1000');

  let i = 0;
  for (let server of new Set(this._servers.values())) {
    console.log(server);
    let origin = Array.from(server.origins)[0];
    let originIps = server.ips

    const originPrefix = `ghd-o${i}`;
    console.log(origin, originIps);

    // for each ip for the origin
    // create a veth pair in ghd-net
    const ips = Array.from(originIps);
    console.log('creating interfaces for', ips);
    ips.forEach((originIp, i) => {
      const hostPrefix = `${originPrefix}h${i}`;
      createVethPair('ghd-net', hostPrefix);
      [
        // connect one to the bridge
        `ip link set ${hostPrefix}-net up`,
        `ip link set ${hostPrefix}-net master ghd-br`,
        // assign the ip to the other
        `ifconfig ${hostPrefix}-cl ${originIp}/32 up`
      ].forEach(cmd => execInNamespace('ghd-net', cmd));
    });

    console.log(`spawning ${['ip', 'netns', 'exec', './har-server.js', origin, ips.join(',')].join(' ')}`);
    const logFile = fs.openSync(
      `/var/log/groundhar-day/${origin.replace(/[^0-9a-zA-Z]+/g, '_')}`,
      'w'
    );
    const child = child_process.spawn(
      'ip',
      [
        'netns', 'exec', 'ghd-net', './har-server.js', origin, ips.join(','),
      ],
      {
        stdio: ['pipe', logFile, logFile]
      }
    );
    servers.add(child);

    child.on('close', (code) => {
      console.log(`har-server.js for ${origin} exited with code ${code}`);
    });

    child.on('error', err => {
      console.error(`har-server.js for ${origin} error: ${err}`);
      process.exit(1);
    });
    stringToStream(JSON.stringify(this._har)).pipe(child.stdin);

    i++;
  }

  // add a route back to the virtualbox internal network
  // FIXME: this should be configurable
  execInNamespace(
    'ghd-net',
    'ip route add 192.168.42.0/24 via 192.168.1.1'
  );
}

/**
 * Reset all origin servers
 */
Environment.prototype.reset = function () {
  const originsReset = [];

  Array.from(this._ipsByOrigin).forEach(([origin, originIps]) => {
    if (originIps.length < 1) {
      return;
    }

    execInNamespace(
      'ghd-cl',
      `curl -X PUT ${origin}/__har_server/reset`
    );
    originsReset.push(origin);
  });

  return originsReset;
};

Environment.prototype.teardown = function () {
};

module.exports = Environment;
