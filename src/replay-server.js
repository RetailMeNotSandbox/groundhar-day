#! /usr/bin/node

const argv = require('yargs').argv;
const child_process = require('child_process');
const express = require('express');
const getStdin = require('get-stdin');
const http = require('http');
const https = require('https');
const http2 = require('spdy');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');

const toOrigin = require('./util').toOrigin;

const responsesByOrigin = new Map();

function createOriginRecord() {
  return {
    paths: new Map()
  };
}

function createPathRecord() {
  return {
    responses: [],
    index: 0
  };
}

const hostnamesByInstance = new Map();
function processConfig(config) {
  responsesByOrigin.clear();

  config.entries.forEach(entry => {
    const parsedUrl = url.parse(entry.request.url);
    const origin = toOrigin(parsedUrl);
    const parsedOrigin = url.parse(origin);
    const instance = url.format({
      protocol: parsedOrigin.protocol,
      hostname: entry.serverIPAddress,
      port: parsedOrigin.port
    });

    if (!hostnamesByInstance.has(instance)) {
      hostnamesByInstance.set(instance, new Set());
    }
    hostnamesByInstance.get(instance).add(parsedUrl.hostname);

    if (!responsesByOrigin.has(origin)) {
      responsesByOrigin.set(origin, createOriginRecord());
    }
    const originRecord = responsesByOrigin.get(origin);

    if (!originRecord.paths.has(parsedUrl.path)) {
      originRecord.paths.set(parsedUrl.path, createPathRecord());
    }
    const pathRecord = originRecord.paths.get(parsedUrl.path);

    const response = Object.assign({}, entry.response);

    response.content = response.content || {};
    if (response.content.size) {
      // convert the text into a buffer
      response.content.encoding = response.content.encoding || 'utf8';
      response.content.buffer =
        Buffer.from(response.content.text, response.content.encoding);

      if (response.content.compression ||
          response.headers.some(header => {
            return header.name.toLowerCase() === 'content-encoding' &&
              header.value.toLowerCase() === 'gzip';
          })
      ) {
        // gzip it
        response.content.buffer = zlib.gzipSync(response.content.buffer);
      }
    } else {
      response.content.buffer = new Buffer(0);
    }

    pathRecord.responses.push(response);
  });
}

const app = express();
app.disable('x-powered-by');

// register control route
const connections = new Set();
app.put('/__har_server/reset', (req, res, next) => {
  console.log(`Resetting responses...`);
  for (let [origin, originRecord] of responsesByOrigin) {
    for (let [path, pathRecord] of originRecord.paths) {
      pathRecord.index = 0;
    }
  }
  console.log('Done.');

  res.status(204);
  res.send();
  connections.forEach(socket => socket.end());
});

// register route
app.all(['/', '/*'], (req, res, next) => {
  console.log(`${req.method} ${req.headers.host} ${req.originalUrl}`);
  try {
    const reqUrl = url.parse(req.originalUrl);
    const reqOrigin =
      toOrigin(url.parse(`${req.protocol}://${req.headers.host}`));

    if (!responsesByOrigin.has(reqOrigin)) {
      throw new Error(
        `Request for ${req.originalUrl} is to unknown origin ${reqOrigin}`
      );
    }

    const paths = responsesByOrigin.get(reqOrigin).paths;

    if (!paths.has(reqUrl.path)) {
      throw new Error(
        `Request for ${req.originalUrl} is to unknown path ${reqUrl.path}`
      );
    }

    const pathResponses = paths.get(reqUrl.path);

    if (pathResponses.index >= pathResponses.responses.length) {
      throw new Error(`Out of responses for ${req.originalUrl}`);
    }

    const response = pathResponses.responses[pathResponses.index++];

    console.log(response.status);
    res.status(parseInt(response.status, 10));

    // set all headers
    console.log(response.headers);
    response.headers.forEach(header => res.set(header.name, header.value));
    res.set('Content-Length', response.content.buffer.length);

    // send the buffer
    var now = Date.now();
    res.end(response.content.buffer, (err) => {
      if (err) {
        console.error(err.message, '\n', err.stack);
        throw err;
      }
      console.log(`Responded with ${response.content.buffer.length} bytes in ${Date.now() - now}ms`);
    });
  } catch (e) {
    console.error(`FAIL: ${e.message}\n${e.stack}`);
    res.status(500);
    res.send(`Server error:\n${e.message}\n${e.stack}`);
  }
});

function onClose(socket) {
  connections.delete(socket);
}

function onConnection(socket) {
  connections.add(socket);
  socket.on('close', onClose.bind(null, socket));
}

console.log(`Starting servers...`);

const certificates = new Map();

function getKeyAndCert(instance) {
  const {hostname, port} = url.parse(instance);
  const keyFilename = `/opt/ca/server-store/${hostname}_${port}.key`;
  const csrFilename = `/opt/ca/server-store/${hostname}_${port}.csr`;
  const certFilename = `/opt/ca/server-store/${hostname}_${port}.cert`;

  console.log(`instance: ${instance}`);
  if (!certificates.has(instance)) {
    console.log('got here');
    console.log(hostnamesByInstance);
    const hostnames = Array.from(hostnamesByInstance.get(instance));
    console.log(`hostnames: ${hostnames}`);
    const SAN = hostnames.map(hostname => `DNS:${hostname}`).join(',');
    console.log(`SAN: ${SAN}`);
    let key, cert;

    try {
      key = fs.readFileSync(keyFilename);
      cert = fs.readFileSync(certFilename);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        throw e;
      }
    }

    if (!key) {
      const cmd = `openssl req -extensions san_env -config /opt/ca/openssl.cnf -nodes -newkey rsa:2048 -keyout ${keyFilename} -out ${csrFilename} -subj "/CN=${hostnames[0]}"`;
      console.log(`Creating key for ${instance}\n${cmd}`);
      child_process.execSync(cmd, {
        env: {
          SAN
        }
      });
      key = fs.readFileSync(keyFilename);
    }

    if (!cert) {
      cmd = `openssl ca -batch -config /opt/ca/openssl.cnf -extensions server_cert -days 375 -notext -md sha256 -in ${csrFilename} -out ${certFilename}`;
      console.log(cmd);
      console.log(`Creating cert for ${instance}\n${cmd}`);
      console.log(`for hostnames: ${hostnames}`);
      child_process.execSync(cmd, {
        env: {
          SAN
        }
      });
      cert = fs.readFileSync(certFilename);
    }

    certificates.set(instance, { key, cert });
  }

  return certificates.get(instance);
}

getStdin().then(configStr => {
  const config = JSON.parse(configStr);
  processConfig(config);

  config.instances.forEach(instance => {
    const {protocol, hostname, port} = url.parse(instance);

    if (protocol === 'http:') {
      server = http.createServer(app);
      server.on('connection', onConnection);
      server.listen(port, hostname);
    } else if (protocol === 'https:') {
      console.log(`starting https server for ${instance}`);
      server = (argv.http2 ? http2 : https).createServer(
          getKeyAndCert(instance),
          app
        );
      server.on('connection', onConnection);
      server.listen(port, hostname);
    } else {
      throw new Error(`Cannot support protocol '${protocol}'`);
    }

    console.log(`Listening on ${hostname}:${port}`);
  });
  console.log('Done');
});
