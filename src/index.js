'use strict';

const child_process = require('child_process');
const express = require('express');
const fs = require('fs');
const mkdirp = require('mkdirp');
const nodeCleanup = require('node-cleanup');
const rimraf = require('rimraf');
const stringToStream = require('string-to-stream');
const url = require('url');

const {
    createNamespace,
    execInNamespace,
    createVethPair,
    deleteVethPair,
    toOrigin
  } = require('./util');

let chromeChild;
const servers = new Set;
function teardown() {
  if (chromeChild) {
    try {
      chromeChild.kill();
    } catch (e) {
      console.error(`Could not kill chrome: ${e}`);
    }
  }

  for (let server of servers) {
    try {
      server.kill();
    } catch (e) {
      console.error(`Could not kill ${server}: ${e}`);
    }
  }

  try {
    deleteVethPair('ghd-net', 'ghd');
  } catch (e) {
    console.error(`Could not delete ghd-cl/net veth pair:\n${e.stack}`);
  }

  try {
    child_process.execSync('ip netns del ghd-net');
  } catch (e) {
    console.error(`Could not delete network namespace:\n${e.stack}`);
  }
}

nodeCleanup((exitCode, signal) => {
  teardown();
});


function Environment(har) {
  this._har = har;
  this._hosts = new Map();
  this._servers = new Map();

  har.log.entries.forEach(entry => {
    const serverIp = entry.serverIPAddress;
    const entryUrl = url.parse(entry.request.url);

    if (serverIp === '') {
      return;
    }

    const origin = toOrigin(entryUrl);

    const ipServer = this._servers.get(serverIp);
    const originServer = this._servers.get(origin);

    if (!ipServer && !originServer) {
      // no server exists for this ip/origin pair, create one
      const server = {
        ips: new Set([serverIp]),
        origins: new Set([origin]),
        instances: new Set(),
        entries: []
      };
      this._servers.set(serverIp, server);
      this._servers.set(origin, server);
    } else if (ipServer !== originServer) {
      // we don't have an ip/origin pair

      if (!ipServer) {
        // new ip for this origin
        originServer.ips.add(serverIp);
        this._servers.set(serverIp, originServer);
      } else if (!originServer) {
        // new origin for this ip
        ipServer.origins.add(origin);
        this._servers.set(origin, ipServer);
      } else {
        // different servers exist for this origin and ip, so merge them by
        // moving all of the origins and ips from the origin server into the ip
        // server
        for (let ip of originServer.ips) {
          ipServer.ips.add(ip);
          this._servers.set(ip, ipServer);
        }

        for (let origin of originServer.origins) {
          ipServer.origins.add(origin);
          this._servers.set(origin, ipServer);
        }
      }
    }

    const parsedOrigin = url.parse(origin);

    const server = this._servers.get(serverIp);
    server.entries.push(entry);
    server.instances.add(
      url.format({
        protocol: entryUrl.protocol,
        hostname: serverIp,
        port: url.parse(origin).port
      })
    );

    // map domain -> ip for building hosts file
    if (!this._hosts.has(entryUrl.hostname)) {
      // map domains to the set of IPs they name
      this._hosts.set(entryUrl.hostname, new Set());
    }
    this._hosts.get(entryUrl.hostname).add(serverIp);
  });

  console.log(this._hosts);
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
    console.log(`${hostCmd} exited with code ${code}`);
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
    let origins = Array.from(server.origins);
    let originIps = server.ips

    const originPrefix = `ghd-o${i}`;
    console.log(origins, originIps);

    // for each ip for the origins
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

    const logFile = fs.openSync(
      `/var/log/groundhar-day/${origins[0].replace(/[^0-9a-zA-Z]+/g, '_')}`,
      'w'
    );
    const child = child_process.spawn(
      'ip',
      ['netns', 'exec', 'ghd-net', './replay-server.js'],
      {
        stdio: ['pipe', logFile, logFile]
      }
    );
    servers.add(child);

    child.on('close', (code) => {
      console.log(`har-server.js for ${origins} exited with code ${code}`);
    });

    child.on('error', err => {
      console.error(`har-server.js for ${origins} error: ${err}`);
      process.exit(1);
    });

    // pass the HAR via stdin so we don't have to write it to disk
    stringToStream(JSON.stringify({
      instances: Array.from(server.instances),
      entries: server.entries
    })).pipe(child.stdin);

    i++;
  }

  // add a route back to the virtualbox internal network
  // FIXME: this should be configurable
  execInNamespace(
    'ghd-net',
    'ip route add 192.168.42.0/24 via 192.168.1.1'
  );

  this._startChrome();
}

Environment.prototype._startChrome = function () {
  // spawn chrome and connect to VM port
  chromeChild = child_process.spawn(
    'ip',
    'netns exec ghd-cl google-chrome-unstable --disable-gpu --headless --remote-debugging-address=192.168.2.2 --remote-debugging-port=9222 --window-size=412,732'.split(' '),
    {
      stdio: 'inherit'
    }
  );

  chromeChild.on('error', (err) => {
    console.error(`Failed to start chrome: ${err}`);
    process.exit(1);
  });
};

/**
 * Reset all origin servers
 */
Environment.prototype.reset = function () {
  this._startChrome();

  for (let server of new Set(this._servers.values())) {

    execInNamespace(
      'ghd-cl',
      `curl -X PUT ${Array.from(server.origins)[0]}/__har_server/reset`
    );
  }
};

Environment.prototype.teardown = teardown;

module.exports = Environment;
