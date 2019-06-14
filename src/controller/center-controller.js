const chalk = require('chalk')
const ms = require('ms')
const assert = require('assert')
const SECConfig = require('../../config/default.json')
const createDebugLogger = require('debug')
const debug = createDebugLogger('core:center-controller')

// -------------------------------  SEC LIBRARY  -------------------------------
const SECDEVP2P = require('@biut-block/biutjs-devp2p')
const NetworkEvent = require('./network-event-controller')
const BlockChain = require('./blockchain')
const NodesIPSync = require('../utils/nodes-ip-sync')
const Utils = require('../utils/utils')

class CenterController {
  constructor (config) {
    // -----------------------------  NODE CONFIG  -----------------------------
    this.NodePort = SECConfig.SECBlock.devp2pConfig.Port
    this.bootstrapNodes = SECConfig.SECBlock.devp2pConfig.mainNetworkNodes
    if (process.env.netType === 'test') {
      this.bootstrapNodes = SECConfig.SECBlock.devp2pConfig.testNetworkNodes
    } else if (process.env.netType === 'develop') {
      this.bootstrapNodes = SECConfig.SECBlock.devp2pConfig.developNetworkNodes
    }

    // -------------------------  NODE DISCOVERY PROTOCOL  -------------------------
    this.ndp = new SECDEVP2P.NDP(config.PRIVATE_KEY, {
      refreshInterval: SECConfig.SECBlock.devp2pConfig.ndp.refreshInterval,
      timeout: SECConfig.SECBlock.devp2pConfig.ndp.timeout,
      endpoint: SECConfig.SECBlock.devp2pConfig.ndp.endpoint
    })

    // ------------------------  RLP TRANSPORT PROTOCOL  -----------------------
    this.rlp = new SECDEVP2P.RLPx(config.PRIVATE_KEY, {
      ndp: this.ndp,
      timeout: SECConfig.SECBlock.devp2pConfig.rlp.timeout,
      maxPeers: SECConfig.SECBlock.devp2pConfig.rlp.maxPeers,
      capabilities: [
        SECDEVP2P.SEC.sec
      ],
      clientId: SECConfig.SECBlock.devp2pConfig.rlp.clientId,
      remoteClientIdFilter: SECConfig.SECBlock.devp2pConfig.rlp.remoteClientIdFilter,
      listenPort: null
    })
    this.config = config

    // -------------------------  NODES SYNC UTIL  ------------------------
    this.nodesIPSync = new NodesIPSync()

    // -------------------  NETWORK STATE MACHINE FLAG  -------------------
    this.syncInfo = {
      flag: false,
      address: null,
      timer: null
    }
    this.NetworkEventContainer = {}

    this.config.syncInfo = this.syncInfo
    config.chainName = 'SEC'
    config.chainID = '010001'
    config.dbconfig.DBPath = config.dbconfig.SecDBPath
    this.secChain = new BlockChain(config)

    config.chainName = 'SEN'
    config.chainID = '010002'
    config.dbconfig.DBPath = config.dbconfig.SenDBPath
    config.secChain = this.secChain
    this.senChain = new BlockChain(config)
    this.secChain.setSenChain(this.senChain)

    this.runningFlag = false
    if (process.env.network && this.runningFlag === false) {
      this.initNetwork()
    }
  }

  _initNDP () {
    this.ndp.on('listening', () => debug(chalk.green(`NDP | NDP Server Listening at port: ${this.NodePort}`)))

    this.ndp.on('close', () => debug(chalk.green('NDP | NDP Server closed')))

    this.ndp.on('error', err => {
      this.config.dbconfig.logger.error(`NDP | NDP error: ${err.stack || err}`)
      console.error(chalk.red(`NDP | NDP error: ${err.stack || err}`))
    })

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
      this.ndp.bootstrap(bootnode).catch(err => {
        this.config.dbconfig.logger.error(`${err.stack || err}`)
        console.error(chalk.bold.red(err.stack || err))
      })
    }
  }

  _initRLP () {
    this.rlp.on('peer:added', peer => {
      const clientId = peer.getHelloMessage().clientId
      const addr = Utils.getPeerAddr(peer)
      const sec = peer.getProtocols()[0]
      debug(chalk.cyan(`RLP | peer:added Event | Add peer: ${addr} ${clientId} (sec${sec.getVersion()}) (total: ${this.rlp.getPeers().length})`))

      // -------------------------------  SEC BLOCK CHAIN  -------------------------------
      // Add new config param ChainID, the first 01 means token chain, last 0001 means this chain is the first token chain
      let secNetworkEvent = new NetworkEvent({ ID: addr, ChainID: '010001', ChainName: 'SEC', BlockChain: this.secChain, NDP: this.ndp, NodesIPSync: this.nodesIPSync, syncInfo: this.syncInfo, logger: this.config.dbconfig.logger })
      secNetworkEvent.PeerCommunication(peer, addr, sec)
      this.NetworkEventContainer['SEC'] = secNetworkEvent

      // -------------------------------  SEN BLOCK CHAIN  -------------------------------
      // Add new config param ChainID, the first 01 means token chain, last 0002 means this chain is the second token chain
      setTimeout(() => {
        let senNetworkEvent = new NetworkEvent({ ID: addr, ChainID: '010002', ChainName: 'SEN', BlockChain: this.senChain, NDP: this.ndp, NodesIPSync: this.nodesIPSync, syncInfo: this.syncInfo, logger: this.config.dbconfig.logger })
        senNetworkEvent.PeerCommunication(peer, addr, sec)
        this.NetworkEventContainer['SEN'] = senNetworkEvent
      }, 10000)
    })

    this.rlp.on('peer:removed', (peer, reasonCode, disconnectWe) => {
      const who = disconnectWe ? 'Disconnect' : 'Peer disconnect'
      const total = this.rlp.getPeers().length
      // remove useless NetworkEvent Instance
      Object.keys(this.NetworkEventContainer).forEach((chainName) => {
        if (this.NetworkEventContainer[chainName].getInstanceID() === Utils.getPeerAddr(peer)) {
          delete this.NetworkEventContainer[chainName]
        }
      })
      this.config.dbconfig.logger.info(chalk.yellow(`RLP | peer:removed Event | Remove peer: ${Utils.getPeerAddr(peer)} - ${who}, reason: ${peer.getDisconnectPrefix(reasonCode)} (${String(reasonCode)}) (total: ${total})`))
      console.log(chalk.yellow(`RLP | peer:removed Event | Remove peer: ${Utils.getPeerAddr(peer)} - ${who}, reason: ${peer.getDisconnectPrefix(reasonCode)} (${String(reasonCode)}) (total: ${total})`))
    })

    this.rlp.on('peer:error', (peer, err) => {
      if (err.code === 'ECONNRESET') return
      if (err instanceof assert.AssertionError) {
        const peerId = peer.getId()
        if (peerId !== null) this.ndp.banPeer(peerId, ms('5m'))
        this.config.dbconfig.logger.error(chalk.red(`RLP | peer:error Event | Peer Error (${Utils.getPeerAddr(peer)}): ${err.message}`))
        console.error(chalk.red(`RLP | peer:error Event | Peer Error (${Utils.getPeerAddr(peer)}): ${err.message}`))
        return
      }
      this.config.dbconfig.logger.error(chalk.red(`RLP | peer:error Event | Peer error (${Utils.getPeerAddr(peer)}): ${err.stack || err}`))
      console.error(chalk.red(`RLP | peer:error Event | Peer error (${Utils.getPeerAddr(peer)}): ${err.stack || err}`))
    })

    this.rlp.on('error', err => {
      this.config.dbconfig.logger.error(chalk.red(`RLP | RLP error: ${err.stack || err}`))
      console.error(chalk.red(`RLP | RLP error: ${err.stack || err}`))
    })

    // Start RLP service and listen port 13331
    this.rlp.listen(SECConfig.SECBlock.devp2pConfig.rlp.endpoint.tcpPort, SECConfig.SECBlock.devp2pConfig.rlp.endpoint.address)
  }

  initNetwork () {
    // -------------------------  IMPORTANT INSTANT  -------------------------
    this.runningFlag = true
    this.config.rlp = this.rlp
    // start BlockChain service first and then init NDP and RLP
    this.secChain.init(this.rlp, (err) => {
      if (err) {
        this.config.dbconfig.logger.error(err)
        return console.error(err)
      }
      debug('secChain init finish')
      this.senChain.init(this.rlp, (err) => {
        if (err) {
          this.config.dbconfig.logger.error(err)
          return console.error(err)
        }
        debug('senChain init finish')
        this._initNDP()
        this._initRLP()
        this._refreshDHTConnections()
        this.secChain.run()
        this.senChain.run()
        this.run()
      })
    })
  }

  getSecChain () {
    return this.secChain
  }

  getSenChain () {
    return this.senChain
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
      this.config.dbconfig.logger.info(chalk.yellow(`Total nodes in NDP: ${peersCount}, RLP Info: peers: ${rlpPeers.length}, open slots: ${openSlots}, queue: ${queueLength} / ${queueLength2}, Time: ${new Date().toISOString()}`))      
      console.log(chalk.yellow(`Total nodes in NDP: ${peersCount}, RLP Info: peers: ${rlpPeers.length}, open slots: ${openSlots}, queue: ${queueLength} / ${queueLength2}, Time: ${new Date().toISOString()}`))
      this.config.dbconfig.logger.info(chalk.yellow(`Current SEC Block Chain Height: ${this.secChain.chain.getCurrentHeight()}, Current SEN Block Chain Height: ${this.senChain.chain.getCurrentHeight()}`))      
      console.log(chalk.yellow(`Current SEC Block Chain Height: ${this.secChain.chain.getCurrentHeight()}, Current SEN Block Chain Height: ${this.senChain.chain.getCurrentHeight()}`))
      rlpPeers.forEach((peer, index) => {
        debug(chalk.yellow(`    Peer ${index + 1} : ${Utils.getPeerAddr(peer)}) in RLP`))
      })
      debug(`Peer nodes' IP addresses: ${rlpPeers}`)
      debug(chalk.blue(`Current SEC Tx Poll Hash Array: ${this.secChain.pool.getTxHashArrayFromPool()}`))
      debug(chalk.blue(`Current SEN Tx Poll Hash Array: ${this.senChain.pool.getTxHashArrayFromPool()}`))
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
  }

  _refreshDHTConnections () {
    setInterval(() => {
      let _peers = this.ndp.getPeers()
      let peers = []
      _peers.forEach(_peer => {
        if (peers.map(peer => { return peer.address }).indexOf(_peer.address) < 0) {
          peers.push(_peer)
        }
      })
      peers.forEach(peer => {
        this.ndp.addPeer({ address: peer.address, udpPort: peer.udpPort, tcpPort: peer.tcpPort }).then((peer) => {
          this.config.dbconfig.logger.info(chalk.green(`DHT reconnecting mechanism: conntect to node: ${peer.address}`))          
          console.log(chalk.green(`DHT reconnecting mechanism: conntect to node: ${peer.address}`))
        }).catch((err) => {
          this.config.dbconfig.logger.error(chalk.red(`ERROR: error on reconnect to node: ${err.stack || err}`))          
          console.log(chalk.red(`ERROR: error on reconnect to node: ${err.stack || err}`))
        })
      })
    }, ms('30m'))
  }
}

module.exports = CenterController
