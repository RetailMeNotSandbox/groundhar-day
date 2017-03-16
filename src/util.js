'use strict';

const child_process = require('child_process');
const fs = require('fs');
const mkdirp = require('mkdirp');
const path = require('path');

function createNamespace(name, config = {}) {

  // To map files (`hosts`, e.g.) into the namespace's `/etc`, specify a
  // map from paths relative to `/etc/netns/<name>` to the file contents.
  //
  // See ip-netns(8)
  // http://man7.org/linux/man-pages/man8/ip-netns.8.html#DESCRIPTION
  if (config.etc) {
    const basePath = `/etc/netns/${name}`;

    mkdirp.sync(basePath),
    Object.keys(config.etc).forEach(filePath => {
      console.log(`absolute path: ${path.resolve(basePath, filePath)}`);
      fs.writeFileSync(
        path.resolve(basePath, filePath), config.etc[filePath]
      );
    });
  }

  child_process.execSync(`ip netns add ${name}`);   
  execInNamespace(
    name,
    'sysctl -w net.ipv4.ip_forward=1'
  );
}

function execInNamespace(namespace, cmd) {
  return child_process.execSync(`ip netns exec ${namespace} ${cmd}`);
}

function createVethPair(namespace, prefix) {
  return execInNamespace(
    namespace,
    `ip link add ${prefix}-cl type veth peer name ${prefix}-net`
  );
}

function deleteVethPair(namespace, prefix) {
  execInNamespace(
    namespace,
    `ip link delete ${prefix}-net`
  );
}

function toOrigin(parsedUrl) {
  const port = parsedUrl.port ||
    parsedUrl.protocol === 'https:' ? '443' : '80';

  return `${parsedUrl.protocol}//${parsedUrl.hostname}:${port}`;
}

module.exports = {
  createNamespace,
  execInNamespace,
  createVethPair,
  deleteVethPair,
  toOrigin
};
