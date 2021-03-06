/**
 * This server is the interface to the groundhar-day VM.
 *
 * It will accept API calls to
 * - create an environment for a HAR/config
 * - reset all servers in the VM
 *
 * It does all the things wrt
 * - processing the HAR and config
 * - creating the topology
 * - spawning the servers
 */
'use strict';

const bodyParser = require('body-parser');
const express = require('express');

const Environment = require('./index');

let env;

const app = express();
app.use(bodyParser.json({ limit: '100mb' }));

/**
 * Upload a HAR to simulate
 */
app.put('/har', (req, res, next) => {
  try {
    if (env) {
      env.teardown();
    }

    env = new Environment(req.body);
    env.initialize();
    res.status(201);
    res.send('Created');
  } catch (e) {
    next(e);
  }
});

/**
 * Reset the origin servers for the current HAR
 */
// FIXME: this should just proxy the request into the environment
app.get('/reset', (req, res, next) => {
  if (!env) {
    res.status(400);
    res.send('There is no active HAR\n');
    return;
  }

  try {
    env.reset();
    res.status(200);
    res.send('All servers reset\n');
  } catch (e) {
    next(e);
  }
});

module.exports = app;
