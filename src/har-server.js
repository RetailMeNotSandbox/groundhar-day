#! /usr/bin/node

const argv = require('yargs').argv;
const child_process = require('child_process');
const express = require('express');
const http = require('http');
const https = require('https');
const http2 = require('spdy');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');

console.log(`argv ${JSON.stringify(argv, null, 2)}`);

if (argv._.length !== 3) {
  console.error(`Expected a HAR filename and host. Got ${argv._}`);
  process.exit(1);
}
const [harFilename, origin, ipList] = argv._;
const {host, protocol, hostname, port} = url.parse(origin);
const ips = ipList.split(',');

let responses;

console.log(`Reading ${path.resolve(harFilename)}`);
const har = JSON.parse(fs.readFileSync(harFilename, 'utf8'));

// find and preprocess all responses for this host
function getResponses() {
  const responses = new Map();
  console.log('Processing HAR...');
  har.log.entries.filter(entry => {
      const match = hostname === url.parse(entry.request.url).host;
      console.log(`Checking ${entry.request.url}...${match}`);
      return match;
    }).forEach(entry => {
      const path = url.parse(entry.request.url).path;

      console.log(`Storing response for ${path}`);
      if (!responses.has(path)) {
        responses.set(path, {
          path,
          responses: []
        });
      }

      const response = Object.assign({}, entry.response);

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

      responses.get(path).responses.push(response);
    });
  console.log('Done');

  return responses;
}

responses = getResponses();

const app = express();
app.disable('x-powered-by');

// register control route
const connections = new Set();
app.put('/__har_server/reset', (req, res, next) => {
  connections.forEach(socket => socket.end());
  responses = getResponses();
  res.status(204);
  res.send();
});

// register route
app.all(['/', '/*'], (req, res, next) => {
  try {
    console.log(`${req.method} ${req.originalUrl}`);

    const reqUrl = url.parse(req.originalUrl);

    if (!responses.has(reqUrl.path)) {
      // return a 404 and log an error
      throw new Error('No response for', reqUrl);
    }

    const response = responses.get(reqUrl.path).responses.shift();

    if (!response) {
      // return a 404 and log an error
      throw new Error('Out of responses for', reqUrl);
    }

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

console.log(`Starting servers for ${origin}...`);
ips.forEach(ip => {
  let server;

  if (protocol === 'http:') {
    server = http.createServer(app);
    server.on('connection', onConnection);
    server.listen(port, ip);
  } else if (protocol === 'https:') {
    // create a cert for this host if one does not exist
    const keyFilename = `${hostname}.key`;
    const certFilename = `${hostname}.cert`;

    if (!fs.existsSync(keyFilename) || !fs.existsSync(certFilename)) {
      console.log(`No key or cert for ${hostname}. Creating...`);

      // create the csr and key
      let cmd = `openssl req -nodes -newkey rsa:2048 -keyout ${keyFilename} -out ${hostname}.csr -subj "/CN=${hostname}"`;
      console.log(cmd);
      child_process.execSync(cmd);

      // create the cert
      cmd = `openssl ca -batch -config /opt/ca/openssl.cnf -extensions server_cert -days 375 -notext -md sha256 -in ${hostname}.csr -out ${certFilename}`;
      console.log(cmd);
      child_process.execSync(cmd);

      console.log('Done');
    }

    server = (argv.http2 ? http2 : https).createServer({
          key: fs.readFileSync(keyFilename),
          cert: fs.readFileSync(certFilename)
        },
        app
      );
    server.on('connection', onConnection);
    server.listen(port, ip);
  } else {
    throw new Error(`Cannot support protocol '${protocol}'`);
  }

  console.log(`Listening on ${ip}:${port}`);
});
console.log('Done');
