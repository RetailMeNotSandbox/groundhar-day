#! /usr/bin/node

const fs = require('fs');
const ipAddress = require('ip-address');
const url = require('url');

const argv = require('yargs').argv;

if (argv._.length !== 1) {
  console.error('Expected a HAR filename. Got', argv._);
  process.exit(1);
}
const harFilename = argv._[0];

const har = JSON.parse(fs.readFileSync(harFilename, 'utf8'));

const domains = new Map();
const origins = new Map();
const originsByIp = new Map();

const ipv6Subnets = new Map();

const hostsPerSubnet = 256;
const baseAddress = '10.0.0.0';

function addToAddress(ip, n) {
  ip = new ipAddress.Address4(ip);

  console.log(ip);
  return ipAddress.Address4.fromInteger(
    parseInt(ip.bigInteger().toString(), 10) + n
  ).address;
}

function getServerIp(ip) {
  if (ip[0] !== '[') {
    // FIXME: hack around IPs that collide with the subnet gateway
    ip = ip.split('.');
    if (ip[3] === '1') {
      ip[3] = '101';
    }

    // it's an ipv4 address, so use it
    return ip.join('.');
  }

  const address = new ipAddress.Address6(`${ip.slice(1, -1)}/64`);
  const canonicalAddress = address.canonicalForm();
  const network = address.startAddress().address;

  if (!ipv6Subnets.has(network)) {
    //console.log(`Creating ${network} -> addToAddress(baseAddress, ipv6Subnets.size * 256)}`);
    ipv6Subnets.set(network, {
      base: addToAddress(baseAddress, ipv6Subnets.size * 256),
      hosts: new Map()
    });
  }

  subnet = ipv6Subnets.get(network);
  if (!subnet.hosts.has(canonicalAddress)) {
    console.log(`${canonicalAddress} -> ${subnet.base}`);
    subnet.hosts.set(
      canonicalAddress,
      addToAddress(subnet.base, subnet.hosts.size + 2)
    );
  }

  return subnet.hosts.get(canonicalAddress);
}

har.log.entries.forEach(entry => {
  const serverIp = getServerIp(entry.serverIPAddress);
  const entryUrl = url.parse(entry.request.url);

  // map domain -> ip for building hosts file
  if (!domains.has(entryUrl.hostname)) {
    // map domains to the set of IPs they name
    domains.set(entryUrl.hostname, new Set());
  }
  domains.get(entryUrl.hostname).add(serverIp);

  const port = entryUrl.port ||
    entryUrl.protocol === 'https:' ? '443' : '80';
  const origin = `${entryUrl.protocol}//${entryUrl.hostname}:${port}`;

  // there may be multiple origins for a given IP address
  const ipOrigin = originsByIp.get(serverIp) || origin;
  if (!origins.has(ipOrigin)) {
    originsByIp.set(serverIp, ipOrigin);
    origins.set(origin, {
      origins: new Set(),
      ips: new Set(),
    });
  }
  origins.get(ipOrigin).ips.add(serverIp);
  origins.get(ipOrigin).origins.add(origin);
});

// write out hosts file
fs.writeFileSync(
  './hosts', 
  Array.from(domains).reduce((hosts, entry) => {
    const [domain, ips] = entry;

    Array.from(ips).forEach(domainIp => {
      hosts.push(`${domainIp}\t${domain}`);
    });

    return hosts;
  }, []).join('\n') +'\n'
);

// write out mininet config
fs.writeFileSync(
  './mininet-config.json',
  JSON.stringify(
    Array.from(origins.entries()).reduce((config, [origin, originRecord]) => {
      console.log(`Config: ${config}\n`);
      
      const ips = Array.from(originRecord.ips.values()).map(ip => {
        console.log(ip);
        let address = new ipAddress.Address4(`${ip}/24`);

        if (!address.isValid()) {
          address = new ipAddress.Address6(`${ip}/64`);
        }

        try {
          return {
            ip,
            subnetMask: address.subnetMask,
            gateway: address.startAddress().address.slice(0, -1) + '1'
          };
        } catch (e) {
          console.log(`Failed to handle ${ip}`);
          throw e;
        }
      });
      const origins = Array.from(originRecord.origins.values());
      config[origin] = {
        ips,
        origins,
        cmd: `./har-server.js ${harFilename} ${origin} ${ips.map(ip => ip.ip).join(',')}`
      };

      return config;
    }, {}),
    null,
    2
  )
);
