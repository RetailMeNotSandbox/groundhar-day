#!/usr/bin/python

import argparse
import json
import re
import subprocess
from urlparse import urlparse
from mininet.node import Node
from mininet.topo import Topo
from mininet.link import TCLink
from mininet.net import Mininet
from mininet.util import dumpNodeConnections
from mininet.log import setLogLevel
from mininet.node import OVSBridge
from mininet.cli import CLI

parser = argparse.ArgumentParser()
parser.add_argument(
  '--config',
  type=str,
  default='/etc/opt/mininet-config.json',
  help='configuration file'
)
parser.add_argument(
  '--bandwidth',
  type=float,
  default=1.6,
  help='bandwidth of the client link in mb'
)
parser.add_argument(
  '--delay',
  type=int,
  default=300,
  help='delay of the client link in ms'
)
parser.add_argument(
  '--jitter',
  type=int,
  default=0,
  help='jitter of the client link in ms'
)
parser.add_argument(
  '--loss',
  type=int,
  default=0,
  help='percentage probability of losing a packet'
)
args = parser.parse_args()

harnet = None

with open(args.config) as data_file:    
  config = json.load(data_file)

class LinuxRouter( Node ):
  "A Node with IP forwarding enabled."

  def config( self, **params ):
    super( LinuxRouter, self).config( **params )
    # Enable forwarding on the router
    self.cmd( 'sysctl net.ipv4.ip_forward=1' )
    self.cmd( 'sysctl net.ipv6.conf.default.forwarding=1' )
    self.cmd( 'sysctl net.ipv6.conf.all.forwarding=1' )

  def terminate( self ):
    self.cmd( 'sysctl net.ipv4.ip_forward=0' )
    self.cmd( 'sysctl net.ipv6.conf.default.forwarding=0' )
    self.cmd( 'sysctl net.ipv6.conf.all.forwarding=0' )
    super( LinuxRouter, self ).terminate()

class HARTopo(Topo):
  def build(self):
    # Router
    router = self.addHost('router', cls=LinuxRouter, ip='192.168.1.1/24')

    # Core switch
    coreSwitch = self.addSwitch('s0', cls=OVSBridge)
    self.addLink(
      coreSwitch,
      router,
      intfName2='router-eth1',
      params2={ 'ip': '192.168.1.1/24' }
    )

    # DNS
    dns = self.addHost(
      'dns',
      ip='192.168.1.100/24',
      defaultRoute='via 192.168.1.1'
    )
    self.addLink(dns, coreSwitch)

gatewayToSwitch = {
  '192.168.1.1': 's0'
}
originToHost = {}

def initializeNet():
  net = Mininet(topo=HARTopo(), controller=None)

  router = net.get('router')

  net.get('dns').cmd(
    'dnsmasq -R -h -H /opt/src/hosts --log-facility=/var/log/har/dns'
  )

  # connect root namespace
  root = Node('root', inNamespace=False)
  intf = net.addLink(
    root,
    net['s0'],
    cls=TCLink,
    bw=args.bandwidth,
    delay='{}ms'.format(args.delay / 2),
    jitter='{}ms'.format(args.jitter),
    loss=args.loss,
  ).intf1
  root.setIP('192.168.1.2/24', intf=intf)
  root.cmd('ip route add default via 192.168.1.1')

  # set up a host per origin
  for origin in config:
    parsedOrigin = urlparse(origin)
    name = re.sub(
      '[^0-9a-zA-Z]+',
      '_',
      '{}-{}-{}'.format(
        parsedOrigin.scheme,
        parsedOrigin.hostname,
        parsedOrigin.port
      )
    )
    print 'Creating host {} for origin {}'.format(name, origin)
    defaultRoute = None

    # create the host
    host = net.addHost(name)
    originToHost[name] = host

    for i, ipRecord in enumerate(config[origin]['ips']):
      ip = ipRecord['ip']
      subnetMask = ipRecord['subnetMask']
      gateway = ipRecord['gateway']

      if not gateway in gatewayToSwitch:
        # if there's no subnet yet, create it
        print 'Creating subnet {}/{}'.format(gateway, subnetMask)

        # create a switch for this subnet
        gatewayToSwitch[gateway] = net.addSwitch(
          's{}'.format(len(gatewayToSwitch) + 1),
          cls=OVSBridge
        )

        # connect it to the router
        intfName = 'router-eth{}'.format(len(gatewayToSwitch) + 1);
        net.addLink(
          gatewayToSwitch[gateway],
          router,
          intfName2=intfName,
          params2={ 'ip': '{}/{}'.format(gateway, subnetMask) }
        )

      # add a link from the host to the switch for this IP
      link = net.addLink(
        host,
        gatewayToSwitch[gateway],
        intfName1='eth{}'.format(i)
      )
      host.setIP(ip, intf=link.intf1, prefixLen=subnetMask)

    # set the first interface as the default gateway
    host.setDefaultRoute('dev eth0 via {}'.format(gateway))

    # run the host command
    cmd = '{} >/var/log/har/{} 2>&1 &'.format(config[origin]['cmd'], name)
    print 'Running command for {}\n{}'.format(name, cmd)
    host.cmd(cmd)
    
  return net

def do_resetservers(self, line):
  print 'Resetting servers',
  dns = harnet.get('dns')

  for origin in config:
    dns.cmd(
      'curl -X PUT -v -s {}/__har_server/reset'.format(origin)
    )
    print '.',
  print 'Done'

if __name__ == '__main__':
  # Tell mininet to print useful information
  setLogLevel('info')
  print config

  print "Initializing network"
  harnet = initializeNet()

  harnet.start()
  print "Testing network connectivity"
  harnet.pingAll()
  CLI.do_resetservers = do_resetservers
  CLI(harnet)

  harnet.get('dns').cmd('/etc/init.d/dnsmasq stop')
  harnet.stop()
