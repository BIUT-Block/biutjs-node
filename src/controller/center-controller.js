const chalk = require('chalk')
const ms = require('ms')
const assert = require('assert')
const SECConfig = require('../../config/default.json')
const _ = require('lodash')
const createDebugLogger = require('debug')
const debug = createDebugLogger('core:center-controller')

// -------------------------------  SEC LIBRARY  -------------------------------
const SECDEVP2P = require('@sec-block/secjs-devp2p')
const NetworkEventToken = require('./network-event-controller-token')
const NetworkEventTx = require('./network-event-controller-tx')
const Consensus = require('./consensus')
const BlockChain = require('./blockchain')
const NodesIPSync = require('../utils/nodes-ip-sync')
const Utils = require('../utils/utils')

class CenterController {
  constructor (config) {
    // -----------------------------  NODE CONFIG  -----------------------------
    this.NodePort = SECConfig.SECBlock.devp2pConfig.Port
    this.bootstrapNodes = SECConfig.SECBlock.devp2pConfig.bootstrapNodes

    // -------------------------  NODE DISCOVERY PROTOCOL  -------------------------
    this.ndp = new SECDEVP2P.NDP(config.PRIVATE_KEY, {
      refreshInterval: SECConfig.SECBlock.devp2pConfig.ndp.refreshInterval,
      timeout: SECConfig.SECBlock.devp2pConfig.ndp.timeout,
      endpoint: SECConfig.SECBlock.devp2pConfig.ndp.endpoint
    })

    // ------------------------  RLP TRANSPORT PROTOCOL  -----------------------
    this.rlp = new SECDEVP2P.RLPx(config.PRIVATE_KEY, {
      ndp: this.ndp,
      maxPeers: SECConfig.SECBlock.devp2pConfig.rlp.maxPeers,
      timeout: SECConfig.SECBlock.devp2pConfig.rlp.timeout,
      capabilities: [
        SECDEVP2P.SEC.sec
      ],
      clientId: SECConfig.SECBlock.devp2pConfig.rlp.clientId,
      remoteClientIdFilter: SECConfig.SECBlock.devp2pConfig.rlp.remoteClientIdFilter,
      listenPort: null
    })
    this.config = config

    this.runningFlag = false
    if (process.env.network && this.runningFlag === false) {
      this.initNetwork()
    }

    // ----------------------------  DB CONFIG  ---------------------------
    this.dbconfig = config.dbconfig

    // -------------------------  NODES SYNC UTIL  ------------------------
    this.nodesIPSync = new NodesIPSync()
  }

  _initNDP () {
    this.ndp.on('listening', () => debug(chalk.green(`NDP | NDP Server Listening at port: ${this.NodePort}`)))

    this.ndp.on('close', () => debug(chalk.green('NDP | NDP Server closed')))

    this.ndp.on('error', err => console.error(chalk.red(`NDP | NDP error: ${err.stack || err}`)))

    this.ndp.on('peer:added', peer => {
      const info = `(${peer.id.toString('hex')}, ${peer.address}:${peer.udpPort}:${peer.tcpPort})`
      debug(chalk.green(`NDP | peer:added Event | New peer: ${info} (total: ${this.ndp.getPeers().length})`))
    })

    this.ndp.on('peer:removed', peer => {
      debug(chalk.yellow(`NDP | peer:removed Event | Remove peer: ${peer.id.toString('hex')} (total: ${this.ndp.getPeers().length})`))
    })

    // check peer:new event
    this.ndp.on('peer:new', peer => {
      const info = `(${peer.id.toString('hex')}, ${peer.address}:${peer.udpPort}:${peer.tcpPort})`
      debug(chalk.green(`NDP | peer:new Event | New peer: ${info} (total: ${this.ndp.getPeers().length})`))
    })

    // accept incoming connections
    this.ndp.bind(this.NodePort, '0.0.0.0')

    // add bootstrap nodes
    const BOOTNODES = this.bootstrapNodes.map(node => {
      return {
        address: node.ip,
        udpPort: node.port,
        tcpPort: node.port
      }
    })
    for (let bootnode of BOOTNODES) {
      this.ndp.bootstrap(bootnode).catch(err => console.error(chalk.bold.red(err.stack || err)))
    }
  }

  _initRLP () {
    this.rlp.on('peer:added', peer => {
      const clientId = peer.getHelloMessage().clientId
      const addr = Utils.getPeerAddr(peer)
      const sec = peer.getProtocols()[0]
      debug(chalk.cyan(`RLP | peer:added Event | Add peer: ${addr} ${clientId} (sec${sec.getVersion()}) (total: ${this.rlp.getPeers().length})`))

      // -------------------------------  TOKEN BLOCK CHAIN  -------------------------------
      let networkEvent = new NetworkEventToken({ ID: addr, BlockChain: this.BlockChain, Consensus: this.tokenConsensus, NDP: this.ndp, NodesIPSync: this.nodesIPSync })
      networkEvent.PeerCommunication(peer, addr, sec)
      this.NetworkEventContainer.push(networkEvent)

      // -------------------------------  TX BLOCK CHAINS  -------------------------------
      for (let txChainID in this.TransactionDbDict) {
        networkEvent = new NetworkEventTx({ ID: txChainID, BlockChain: this.BlockChain, Consensus: this.txConsensusDict[txChainID], NDP: this.ndp })
        networkEvent.PeerCommunication(peer, addr, sec)
        this.NetworkEventContainer.push(networkEvent)
      }
    })

    this.rlp.on('peer:removed', (peer, reasonCode, disconnectWe) => {
      const who = disconnectWe ? 'Disconnect' : 'Peer disconnect'
      const total = this.rlp.getPeers().length
      // remove useless NetworkEvent Instance
      _.remove(this.NetworkEventContainer, networkEvent => {
        return networkEvent.getInstanceID() === Utils.getPeerAddr(peer)
      })
      console.log(chalk.yellow(`RLP | peer:removed Event | Remove peer: ${Utils.getPeerAddr(peer)} - ${who}, reason: ${peer.getDisconnectPrefix(reasonCode)} (${String(reasonCode)}) (total: ${total})`))
    })

    this.rlp.on('peer:error', (peer, err) => {
      if (err.code === 'ECONNRESET') return
      if (err instanceof assert.AssertionError) {
        const peerId = peer.getId()
        if (peerId !== null) this.ndp.banPeer(peerId, ms('5m'))
        console.error(chalk.red(`RPL | peer:error Event | Peer Error (${Utils.getPeerAddr(peer)}): ${err.message}`))
        return
      }
      console.error(chalk.red(`RPL | peer:error Event | Peer error (${Utils.getPeerAddr(peer)}): ${err.stack || err}`))
    })

    this.rlp.on('error', err => console.error(chalk.red(`RLP | RLP error: ${err.stack || err}`)))

    // Start RLP service and listen port 13331
    this.rlp.listen(SECConfig.SECBlock.devp2pConfig.rlp.endpoint.tcpPort, SECConfig.SECBlock.devp2pConfig.rlp.endpoint.address)
  }

  _runConsensus () {
    this.tokenConsensus.run()
    for (let txChainID in this.txConsensusDict) {
      this.txConsensusDict[txChainID].run()
    }
  }

  initNetwork () {
    // -------------------------  IMPORTANT INSTANT  -------------------------
    this.runningFlag = true
    this.config.rlp = this.rlp
    // start BlockChain service first and then init NDP and RLP
    this.BlockChain = new BlockChain(this.config, () => {
      debug('BlockChain init finish')
      this._initNDP()
      this._initRLP()
      this.__refreshDHTConnections()
      this.run()
    })
    this.BlockChain.run()
    this.config.BlockChain = this.BlockChain
    this.TransactionDbDict = this.config.SECTxDbDict
    this.NetworkEventContainer = []

    this.config.isTokenChain = true
    this.tokenConsensus = new Consensus(this.config)
    this.txConsensusDict = {}
    this.config.isTokenChain = false
    for (let txChainID in this.TransactionDbDict) {
      this.config.ID = txChainID
      this.txConsensusDict[txChainID] = new Consensus(this.config)
    }
  }

  getBlockchain () {
    return this.BlockChain
  }

  run () {
    // Only export running states
    setInterval(() => {
      const peers = this.ndp.getPeers()
      const peersCount = peers.length
      const rlpPeers = this.rlp.getPeers()
      const openSlots = this.rlp._getOpenSlots()
      const queueLength = this.rlp._peersQueue.length
      const queueLength2 = this.rlp._peersQueue.filter((o) => o.ts <= Date.now()).length
      console.log(chalk.yellow(`Total nodes in NDP: ${peersCount}, RLP Info: peers: ${rlpPeers.length}, open slots: ${openSlots}, queue: ${queueLength} / ${queueLength2}, Time: ${new Date().toISOString()}`))
      rlpPeers.forEach((peer, index) => {
        debug(chalk.yellow(`    Peer ${index + 1} : ${Utils.getPeerAddr(peer)}) in RLP`))
      })
      debug(`Peer nodes' IP addresses: ${rlpPeers}`)
      debug(chalk.blue('Current Token Transaction Poll Hash Array:'))
      debug(this.BlockChain.TokenPool.getTxHashArrayFromPool())
      for (let txChainID in this.txConsensusDict) {
        debug(chalk.blue(`Current Tx Transaction Poll(ID: ${txChainID}) Hash Array:`))
        debug(this.BlockChain.TxPoolDict[txChainID].getTxHashArrayFromPool())
      }
      // for refresh NodesTable
      let _peers = []
      peers.forEach(peer => {
        _peers.push({
          id: peer.id.toString('hex'),
          address: peer.address,
          udpPort: peer.udpPort,
          tcpPort: peer.tcpPort
        })
      })
      this.nodesIPSync.updateNodesTable(_peers)
    }, ms('30s'))
    this._runConsensus()
  }

  _refreshDHTConnections () {
    setInterval(() => {
      const peers = this.ndp.getPeers()
      peers.forEach(peer => {
        this.NDP.addPeer({ address: peer.address, udpPort: peer.udpPort, tcpPort: peer.tcpPort }).then((peer) => {
          console.log(chalk.green(`DHT reconnecting mechanism: conntect to node: ${peer.address}`))
        }).catch((err) => {
          console.error(chalk.red(`ERROR: error on reconnect to node: ${err.stack || err}`))
        })
      })
    }, ms('30s'))
  }
}

module.exports = CenterController
