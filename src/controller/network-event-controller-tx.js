const chalk = require('chalk')
const ms = require('ms')
const LRUCache = require('lru-cache')
const SECConfig = require('../../config/default.json')
const util = require('util')
const createDebugLogger = require('debug')
const debug = createDebugLogger('core:network:tx')

// -------------------------------  SEC LIBRARY  -------------------------------
const SECDEVP2P = require('@sec-block/secjs-devp2p')
const SECBlockChain = require('@sec-block/secjs-blockchain')
const SECTransaction = require('@sec-block/secjs-tx')

const MainUtils = require('../utils/utils')
const txCache = new LRUCache({ max: SECConfig.SECBlock.devp2pConfig.txCache })
const blocksCache = new LRUCache({ max: SECConfig.SECBlock.devp2pConfig.blocksCache })

class NetworkEventTx {
  constructor (config) {
    this.ID = config.ID
    this.BlockChain = config.BlockChain
    this.Consensus = config.Consensus
    this.NDP = config.NDP
    // this.logger = config.SECLogger

    // ---------------------------  CHECK PARAMETERS  ---------------------------
    this.CHAIN_ID = SECConfig.SECBlock.checkConfig.CHAIN_ID
    this.CHECK_BLOCK_TITLE = SECConfig.SECBlock.checkConfig.CHECK_BLOCK_TITLE
    this.CHECK_BLOCK_NR = SECConfig.SECBlock.checkConfig.CHECK_BLOCK_NR

    // ------------------------------  Parameters  ------------------------------
    this.forkDrop = null
    this.forkVerified = false
    this.peer = {}
    this.addr = {}
    this.sec = {}
  }

  getInstanceID () {
    return this.ID
  }

  PeerCommunication (peer, addr, sec) {
    this.peer = peer
    this.addr = addr
    this.sec = sec

    const requests = {
      headers: [],
      bodies: [],
      msgTypes: {}
    }
    let status = {
      networkId: this.CHAIN_ID,
      td: 0, // transaction block chain does not have difficulty
      bestHash: Buffer.from(this.BlockChain.SECTransactionBlockChainDict[this.ID].getLastBlockHash(), 'hex'),
      genesisHash: Buffer.from(this.BlockChain.SECTransactionBlockChainDict[this.ID].getGenesisBlockHash(), 'hex')
    }
    this.sec.sendStatus(status)
    debug(chalk.bold.yellowBright('Sending Local Status to Peer...'))
    debug(status)

    // ------------------------------  CHECK FORK  -----------------------------
    this.sec.once('status', () => {
      debug('Running first time Status Check...')
      this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_HEADERS, [Buffer.from(this.ID, 'utf-8'), [this.CHECK_BLOCK_NR, 1, 0, 0]])
      this.forkDrop = setTimeout(() => {
        peer.disconnect(SECDEVP2P.RLPx.DISCONNECT_REASONS.USELESS_PEER)
      }, ms('15s'))
      peer.once('close', () => clearTimeout(this.forkDrop))
    })

    this.sec.on('message', async (code, payload) => {
      if (code in requests.msgTypes) {
        requests.msgTypes[code] += 1
      } else {
        requests.msgTypes[code] = 1
      }
      let chainID = payload[0].toString('utf-8')
      if (chainID !== this.ID) {
        return
      }
      payload = payload[1]
      debug(chalk.bold.greenBright(`==================== On Message from ${this.addr} ====================`))
      debug('Requests: ')
      debug(requests)
      debug('Code: ' + code)
      switch (code) {
        case SECDEVP2P.SEC.MESSAGE_CODES.STATUS:
          this.STATUS(payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK_HASHES:
          this.NEW_BLOCK_HASHES(payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_HEADERS:
          this.GET_BLOCK_HEADERS(payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_HEADERS:
          this.BLOCK_HEADERS(payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_BODIES:
          this.GET_BLOCK_BODIES(payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_BODIES:
          this.BLOCK_BODIES(payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK:
          this.NEW_BLOCK(payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.TX:
          this.TX(payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.GET_NODE_DATA:
          this.GET_NODE_DATA(payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA:
          this.NODE_DATA(payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.GET_RECEIPTS:
          this.GET_RECEIPTS(payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.RECEIPTS:
          this.RECEIPTS(payload, requests)
          break
      }
      debug(chalk.bold.greenBright(`==================== End On Message from ${this.addr} ====================\n\n`))
    })
  }

  STATUS (payload, requests) {
    debug(chalk.bold.yellow(`===== STATUS =====`))
    debug(`Remote Status: `)
    debug(MainUtils.toStringArray(payload))
    debug(chalk.bold.yellow(`===== End STATUS =====`))
  }

  NEW_BLOCK_HASHES (payload, requests) {
    debug(chalk.bold.yellow(`===== NEW_BLOCK_HASHES =====`))
    if (!this.forkVerified) return
    for (let blockHash of payload) {
      debug(`New Block Hash from Remote: ${blockHash.toString('hex')}`)
      if (blocksCache.has(blockHash.toString('hex'))) {
        debug('Block Hash already existed in Cache')
        continue
      }
      setTimeout(() => {
        debug('Send GET_BLOCK_HEADERS Message')
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_HEADERS, [Buffer.from(this.ID, 'utf-8'), [blockHash, 1, 0, 0]])
        requests.headers.push(blockHash)
      }, ms('0.1s'))
    }
    debug(chalk.bold.yellow(`===== End NEW_BLOCK_HASHES End =====`))
  }

  GET_BLOCK_HEADERS (payload, requests) {
    debug(chalk.bold.yellow(`===== GET_BLOCK_HEADERS =====`))
    let headers = []
    if (this.forkVerified) {
      let blockHeaderHash = payload[0].toString('hex')
      let localTxBlockchain = this.BlockChain.SECTransactionBlockChainDict[this.ID].getBlockChain()
      let _block = localTxBlockchain.filter(_block => _block.Hash === blockHeaderHash)[0]
      if (_block) {
        let localTxBlock = new SECBlockChain.SECTransactionBlock(_block)
        headers.push([localTxBlock.getBlockHeaderBuffer(), Buffer.from(_block.Beneficiary)])
      }
    } else {
      debug('REMOTE CHECK_BLOCK_NR: ' + SECDEVP2P._util.buffer2int(payload[0]))
      if (SECDEVP2P._util.buffer2int(payload[0]) === this.CHECK_BLOCK_NR) {
        let block = this.BlockChain.SECTransactionBlockChainDict[this.ID].getBlockChain()[this.CHECK_BLOCK_NR - 1]
        let checkBlock = new SECBlockChain.SECTransactionBlock(block)
        headers.push([checkBlock.getBlockHeaderBuffer(), Buffer.from(checkBlock.getBlock().Beneficiary)])
        debug('REMOTE CHECK_BLOCK_HEADER: ')
        debug(util.inspect(checkBlock.getBlockHeaderBuffer(), false, null))
      }
    }
    debug('SEC Send Message: BLOCK_HEADERS')
    this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_HEADERS, [Buffer.from(this.ID, 'utf-8'), headers])
    debug(chalk.bold.yellow(`===== End GET_BLOCK_HEADERS =====`))
  }

  BLOCK_HEADERS (payload, requests) {
    debug(chalk.bold.yellow(`===== BLOCK_HEADERS =====`))
    if (!this.forkVerified) {
      if (payload.length !== 1) {
        debug(`${this.addr} expected one header for ${this.CHECK_BLOCK_TITLE} verify (received: ${payload.length})`)
        this.peer.disconnect(SECDEVP2P.RLPx.DISCONNECT_REASONS.USELESS_PEER)
        return
      }
      let expectedHash = this.BlockChain.SECTransactionBlockChainDict[this.ID].getGenesisBlockHash()
      debug(`Expected Hash: ${expectedHash}`)
      let block = new SECBlockChain.SECTransactionBlock()
      block.setBlockHeaderFromBuffer(payload[0][0])
      debug(`Remote Header Hash: ${block.getBlockHeaderHash()}`)
      if (block.getBlockHeaderHash() === expectedHash) {
        debug(`${this.addr} verified to be on the same side of the ${this.CHECK_BLOCK_TITLE}`)
        clearTimeout(this.forkDrop)
        this.forkVerified = true
        debug(`forkVerified: ${this.forkVerified}`)
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_NODE_DATA, [Buffer.from(this.ID, 'utf-8'), []])
        this._addPeerToNDP()
      }
    } else {
      if (payload.length > 1) {
        debug(`${this.addr} not more than one block header expected (received: ${payload.length})`)
        return
      }
      let isValidPayload = false
      let block = new SECBlockChain.SECTransactionBlock()
      block.setBlockHeaderFromBuffer(payload[0][0])
      while (requests.headers.length > 0) {
        const blockHash = requests.headers.shift()
        debug('Remote Block Header: ' + blockHash.toString('hex'))
        if (block.getBlockHeaderHash() === blockHash.toString('hex')) {
          isValidPayload = true
          setTimeout(() => {
            this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_BODIES, [Buffer.from(this.ID, 'utf-8'), [blockHash]])
            debug('block headers block: ', block)
            requests.bodies.push(block)
          }, ms('0.1s'))
          break
        }
      }
      if (!isValidPayload) {
        debug(`${this.addr} received wrong block header ${block.getBlockHeaderHash()}`)
      }
    }
    debug(chalk.bold.yellow(`===== End BLOCK_HEADERS =====`))
  }

  GET_BLOCK_BODIES (payload, requests) {
    debug(chalk.bold.yellow(`===== GET_BLOCK_BODIES =====`))

    let bodies = []
    let blockHeaderHash = payload[0].toString('hex')
    let localTxBlockchain = this.BlockChain.SECTransactionBlockChainDict[this.ID].getBlockChain()
    let _block = localTxBlockchain.filter(_block => _block.Hash === blockHeaderHash)[0]
    if (_block) {
      let localTxBlock = new SECBlockChain.SECTransactionBlock(_block)
      debug('Beneficiary: ' + _block.Beneficiary)
      bodies.push([localTxBlock.getBlockBodyBuffer(), Buffer.from(_block.Beneficiary)])
    }
    this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_BODIES, [Buffer.from(this.ID, 'utf-8'), bodies])

    debug(chalk.bold.yellow(`===== End GET_BLOCK_BODIES =====`))
  }

  BLOCK_BODIES (payload, requests) {
    debug(chalk.bold.yellow(`===== BLOCK_BODIES =====`))
    if (!this.forkVerified) return
    if (payload.length !== 1) {
      debug(`${this.addr} not more than one block body expected (received: ${payload.length})`)
      return
    }
    let isValidPayload = false
    debug('block body requests.bodies: ', requests.bodies)
    while (requests.bodies.length > 0) {
      const block = requests.bodies.shift()
      block.setBlockBodyFromBuffer(payload[0][0])
      let _block = block.getBlock()
      debug('Remote Beneficiary: ' + payload[0][1].toString())
      _block.Beneficiary = payload[0][1].toString()
      let NewSECBlock = new SECBlockChain.SECTransactionBlock(_block)
      let secblock = NewSECBlock.getBlock()
      secblock.Transactions = JSON.parse(JSON.stringify(secblock.Transactions))
      isValidPayload = true
      if (secblock.Number === this.BlockChain.SECTransactionBlockChainDict[this.ID].getCurrentHeight() + 1) {
        try {
          this.BlockChain.SECTransactionBlockChainDict[this.ID].putBlockToDB(secblock, () => {
            debug(chalk.green(`Get New Transaction Block from: ${this.addr} and saved in local Blockchain`))
            let newSECTxBlock = new SECBlockChain.SECTransactionBlock(secblock)
            this._onNewBlock(newSECTxBlock)
            // this.logger.debug(`DEBUG: Get New Transaction Block from: ${this.addr} and saved in local Blockchain ${this.ID}, block height is ${newSECTxBlock.getBlock().Number}`)
          })
        } catch (error) {
          // this.logger.error('ERROR: tx chain, BLOCK_BODIES state, error occurs when writing new block to DB: ', error)
          // TODO: to be tested
          let NodeData = [
            1,
            SECDEVP2P._util.int2buffer(this.BlockChain.SECTransactionBlockChainDict[this.ID].getCurrentHeight()),
            Buffer.from(this.BlockChain.SECTransactionBlockChainDict[this.ID].getLastBlockHash(), 'hex'),
            Buffer.from(this.BlockChain.SECTransactionBlockChainDict[this.ID].getGenesisBlockHash(), 'hex'),
            Buffer.from(JSON.stringify(this.BlockChain.SECTransactionBlockChainDict[this.ID].getHashList()))
          ]
          this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [Buffer.from(this.ID, 'utf-8'), NodeData])
        }
      } else if (secblock.Number > this.BlockChain.SECTransactionBlockChainDict[this.ID].getCurrentHeight() + 1) {
        let NodeData = [
          1,
          SECDEVP2P._util.int2buffer(this.BlockChain.SECTransactionBlockChainDict[this.ID].getCurrentHeight()),
          Buffer.from(this.BlockChain.SECTransactionBlockChainDict[this.ID].getLastBlockHash(), 'hex'),
          Buffer.from(this.BlockChain.SECTransactionBlockChainDict[this.ID].getGenesisBlockHash(), 'hex'),
          Buffer.from(JSON.stringify(this.BlockChain.SECTransactionBlockChainDict[this.ID].getHashList()))
        ]
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [Buffer.from(this.ID, 'utf-8'), NodeData])
      } else {
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_NODE_DATA, [Buffer.from(this.ID, 'utf-8'), []])
      }
      // const isValid = await this._isValidBlock(block)
      // if (isValid) {
      //   isValidPayload = true
      //   this._onNewBlock(block, this.peer)
      //   break
      // }
    }
    if (!isValidPayload) {
      debug(`${this.addr} received wrong block body`)
    }
    debug(chalk.bold.yellow(`===== End BLOCK_BODIES =====`))
  }

  NEW_BLOCK (payload, requests) {
    debug(chalk.bold.yellow(`===== NEW_BLOCK =====`))
    if (!this.forkVerified) return
    let blockArray = []
    payload.forEach(_payload => {
      let newTxBlock = new SECBlockChain.SECTransactionBlock()
      newTxBlock.setBlockFromBuffer(_payload)
      if (!blocksCache.has(newTxBlock.getBlockHeaderHash())) {
        let block = Object.assign({}, newTxBlock.getBlock())
        blockArray.push(block)
        blocksCache.set(newTxBlock.getBlockHeaderHash(), true)
      }
    })
    if (blockArray.length !== 0) {
      this.BlockChain.SECTransactionBlockChainDict[this.ID].updateBlockchain(blockArray[0].Number, blockArray, (err) => {
        if (err) {
          // this.logger.error('ERROR: tx chain, NEW_BLOCK state, updateBlockchain function callback error: ', err)
        }
        debug(blockArray.length + ' Blocks updated')
        debug('Update Transaction Blockchain Finished!')
        // this.logger.debug(`DEBUG: Update Transaction Blockchain ${this.ID} Finished! starting block number is ${blockArray[0].Number}, update length is ${blockArray.length}`)
        this.BlockChain.TxPoolDict[this.ID].updateByBlockChain(this.BlockChain.SECTransactionBlockChainDict[this.ID])
        debug(chalk.bold.yellow(`===== NEW_BLOCK End =====`))
      })
    }
    // const isValidNewBlock = await this._isValidBlock(newTxBlock)
    // if (isValidNewBlock) this._onNewBlock(newBlock, this.peer)
  }

  TX (payload, requests) {
    debug(chalk.bold.yellow(`===== TX =====`))
    if (!this.forkVerified) return
    for (let txBuffer of payload) {
      let TransactionTx = new SECTransaction.SECTransactionTx(txBuffer)
      if (this._isValidTx(TransactionTx)) this._onNewTx(TransactionTx)
    }
    debug(chalk.bold.yellow(`===== End TX =====`))
  }

  GET_NODE_DATA (payload, requests) {
    debug(chalk.bold.yellow(`===== GET_NODE_DATA =====`))
    let NodeData = [
      1,
      SECDEVP2P._util.int2buffer(this.BlockChain.SECTransactionBlockChainDict[this.ID].getCurrentHeight()),
      Buffer.from(this.BlockChain.SECTransactionBlockChainDict[this.ID].getLastBlockHash(), 'hex'),
      Buffer.from(this.BlockChain.SECTransactionBlockChainDict[this.ID].getGenesisBlockHash(), 'hex'),
      Buffer.from(JSON.stringify(this.BlockChain.SECTransactionBlockChainDict[this.ID].getHashList()))
    ]
    this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [Buffer.from(this.ID, 'utf-8'), NodeData])
    debug(chalk.bold.yellow(`===== End GET_NODE_DATA =====`))
  }

  NODE_DATA (payload, requests) {
    debug(chalk.bold.yellow(`===== NODE_DATA =====`))
    let localHeight = this.BlockChain.SECTransactionBlockChainDict[this.ID].getCurrentHeight()
    let localLastHash = this.BlockChain.SECTransactionBlockChainDict[this.ID].getLastBlockHash()
    let localHashList = this.BlockChain.SECTransactionBlockChainDict[this.ID].getHashList()
    let remoteHeight = SECDEVP2P._util.buffer2int(payload[1])
    let remoteLastHash = payload[2].toString('hex')
    let remoteHashList = JSON.parse(payload[4].toString())
    debug('local Height: ' + localHeight)
    debug('local Lasthash: ' + localLastHash)
    debug('remote Height: ' + remoteHeight)
    debug('remote Lasthash: ' + remoteLastHash)

    if (localHeight > remoteHeight) {
      debug('Local Transaction Blockchain Length longer than remote Node')
      let blockPosition = localHashList.filter(block => (block.Hash === remoteLastHash && block.Number === remoteHeight))
      if (blockPosition.length > 0) {
        debug('No Fork founded!')
        let newBlocks = this.BlockChain.SECTransactionBlockChainDict[this.ID].getBlockChain().slice(remoteHeight + 1)
        let newBlockBuffers = newBlocks.map(_block => {
          return new SECBlockChain.SECTransactionBlock(_block).getBlockBuffer()
        })
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK, [Buffer.from(this.ID, 'utf-8'), newBlockBuffers])
      } else {
        debug('Fork founded!')
        let forkPosition = 0
        for (let i = remoteHeight - 1; i >= 0; i--) {
          if (localHashList.filter(block => (block.Hash === remoteHashList[i].Hash)).length > 0) {
            forkPosition = i + 1
            debug('Fork Position: ' + forkPosition)
            break
          }
        }
        let newBlocks = this.BlockChain.SECTransactionBlockChainDict[this.ID].getBlockChain().slice(forkPosition)
        let newBlockBuffers = newBlocks.map(_block => {
          return new SECBlockChain.SECTransactionBlock(_block).getBlockBuffer()
        })
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK, [Buffer.from(this.ID, 'utf-8'), newBlockBuffers])
      }
    }
    debug(chalk.bold.yellow(`===== End NODE_DATA =====`))
  }

  GET_RECEIPTS (payload, requests) {
    debug(chalk.bold.yellow(`===== GET_RECEIPTS =====`))
    this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.RECEIPTS, [Buffer.from(this.ID, 'utf-8'), []])
    debug(chalk.bold.yellow(`===== End GET_RECEIPTS =====`))
  }

  RECEIPTS (payload, requests) {
    debug(chalk.bold.yellow(`===== RECEIPTS =====`))
    debug(chalk.bold.yellow(`===== End RECEIPTS =====`))
  }

  _onNewTx (tx) {
    const txHashHex = tx.getTxHash()
    if (txCache.has(txHashHex)) return
    txCache.set(txHashHex, true)
    this.BlockChain.TxPoolDict[this.ID].addTxIntoPool(tx.getTx())
    debug(tx.getTx())
    this.BlockChain.sendNewTxTx(tx, this.ID, this.peer)
    console.log(`New Tx Tx: ${tx.getTx().TxHash} (from ${MainUtils.getPeerAddr(this.peer)})`)
  }

  _onNewBlock (newSECTxBlock) {
    blocksCache.set(newSECTxBlock.getBlockHeaderHash(), true)
    this.BlockChain.sendNewTxBlockHash(newSECTxBlock, this.ID, this.peer)
    debug('----------------------------------------------------------------------------------------------------------')
    console.log(`New Tx Block ${newSECTxBlock.getBlock().Number}: ${newSECTxBlock.getBlock().Hash} (from ${MainUtils.getPeerAddr(this.peer)})`)
    debug('----------------------------------------------------------------------------------------------------------')
    this.BlockChain.TxPoolDict[this.ID].updateByBlockChain(this.BlockChain.SECTransactionBlockChainDict[this.ID])
  }

  // TODO: must be reimplemented
  _isValidTx (tx) {
    return true
    // return tx.validate(false)
  }

  _addPeerToNDP () {
    debug('Adding Node to NDP Service...')
    this.NDP.addPeer({ address: this.peer._socket.remoteAddress, udpPort: SECConfig.SECBlock.devp2pConfig.ndp.endpoint.udpPort, tcpPort: SECConfig.SECBlock.devp2pConfig.ndp.endpoint.tcpPort }).then((peer) => {
      debug('Added Node to NDP Service successful')
      debug('NDP Node Info: ')
      debug(peer)
    }).catch((err) => {
      debug(`error on connection to node: ${err.stack || err}`)
      // this.logger.error(`ERROR: tx chain, error on connection to node: ${err.stack || err}`)
    })
  }

  // TODO: must be reimplement
  async _isValidBlock (block) {
    // if (!block.validateUnclesHash()) return false
    // if (!block.transactions.every(this._isValidTx)) return false
    // return new Promise((resolve, reject) => {
    //   block.genTxTrie(() => {
    //     try {
    //       resolve(block.validateTransactionsTrie())
    //     } catch (err) {
    //       reject(err)
    //     }
    //   })
    // })
    return true
  }
}

module.exports = NetworkEventTx
