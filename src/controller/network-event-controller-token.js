const chalk = require('chalk')
const ms = require('ms')
const LRUCache = require('lru-cache')
const SECConfig = require('../../config/default.json')
const util = require('util')
const createDebugLogger = require('debug')
const debug = createDebugLogger('core:network:token')
const _ = require('lodash')

// -------------------------------  SEC LIBRARY  -------------------------------
const SECDEVP2P = require('@sec-block/secjs-devp2p')
const SECBlockChain = require('@sec-block/secjs-blockchain')
const SECTransaction = require('@sec-block/secjs-tx')

const MainUtils = require('../utils/utils')
const txCache = new LRUCache({ max: SECConfig.SECBlock.devp2pConfig.txCache })
const blocksCache = new LRUCache({ max: SECConfig.SECBlock.devp2pConfig.blocksCache })

class NetworkEvent {
  constructor (config) {
    this.ID = config.ID
    this.BlockChain = config.BlockChain
    this.Consensus = config.Consensus
    this.NDP = config.NDP
    // this.logger = config.SECLogger

    // ---------------------------  CHECK PARAMETERS  --------------------------
    this.CHAIN_ID = SECConfig.SECBlock.checkConfig.CHAIN_ID
    this.CHECK_BLOCK_TITLE = SECConfig.SECBlock.checkConfig.CHECK_BLOCK_TITLE
    this.CHECK_BLOCK_NR = SECConfig.SECBlock.checkConfig.CHECK_BLOCK_NR

    // --------------------------------  Parameters  -------------------------------
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
      td: SECDEVP2P._util.int2buffer(this.BlockChain.SECTokenBlockChain.getGenesisBlockDifficulty()),
      bestHash: Buffer.from(this.BlockChain.SECTokenBlockChain.getLastBlockHash(), 'hex'),
      genesisHash: Buffer.from(this.BlockChain.SECTokenBlockChain.getGenesisBlockHash(), 'hex')
    }
    this.sec.sendStatus(status)
    debug(chalk.bold.yellowBright('Sending Local Status to Peer...'))
    debug(status)

    // ------------------------------  CHECK FORK  -----------------------------
    this.sec.once('status', () => {
      debug('Running first time Status Check...')
      this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_HEADERS, [Buffer.from('token', 'utf-8'), [this.CHECK_BLOCK_NR, 1, 0, 0]])
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
      if (chainID !== 'token') {
        debug(`not token chain, chainID is ${chainID}, typeof chainID is ${typeof chainID}`)
        return
      }
      payload = payload[1]
      debug(chalk.bold.greenBright(`==================== On Message form ${this.addr} ====================`))
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
      debug(chalk.bold.greenBright(`==================== End On Message form ${this.addr} ====================\n\n`))
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
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_HEADERS, [Buffer.from('token', 'utf-8'), [blockHash, 1, 0, 0]])
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
      debug('Get Block Hash: ' + blockHeaderHash)
      let localTokenBlockchain = this.BlockChain.SECTokenBlockChain.getBlockChain()
      let _block = localTokenBlockchain.filter(_block => _block.Hash === blockHeaderHash)[0]
      if (_block) {
        let localTokenBlock = new SECBlockChain.SECTokenBlock(_block)
        headers.push([localTokenBlock.getBlockHeaderBuffer(), Buffer.from(_block.Beneficiary)])
      }
    } else {
      debug('REMOTE CHECK_BLOCK_NR: ' + SECDEVP2P._util.buffer2int(payload[0]))
      if (SECDEVP2P._util.buffer2int(payload[0]) === this.CHECK_BLOCK_NR) {
        let block = this.BlockChain.SECTokenBlockChain.getBlockChain()[this.CHECK_BLOCK_NR - 1]
        let checkBlock = new SECBlockChain.SECTokenBlock(block)
        headers.push([checkBlock.getBlockHeaderBuffer(), Buffer.from(checkBlock.getBlock().Beneficiary)])
        debug('REMOTE CHECK_BLOCK_HEADER: ')
        debug(util.inspect(checkBlock.getBlockHeaderBuffer(), false, null))
      }
    }
    debug('SEC Send Message: BLOCK_HEADERS')
    this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_HEADERS, [Buffer.from('token', 'utf-8'), headers])
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
      let expectedHash = this.BlockChain.SECTokenBlockChain.getGenesisBlockHash()
      debug(`Expected Hash: ${expectedHash}`)
      let block = new SECBlockChain.SECTokenBlock()
      block.setBlockHeaderFromBuffer(payload[0][0])
      debug(`Remote Header Hash: ${block.getBlockHeaderHash()}`)
      if (block.getBlockHeaderHash() === expectedHash) {
        debug(`${this.addr} verified to be on the same side of the ${this.CHECK_BLOCK_TITLE}`)
        clearTimeout(this.forkDrop)
        this.forkVerified = true
        debug(`forkVerified: ${this.forkVerified}`)
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_NODE_DATA, [Buffer.from('token', 'utf-8'), []])
        this._addPeerToNDP()
      }
    } else {
      if (payload.length > 1) {
        debug(`${this.addr} not more than one block header expected (received: ${payload.length})`)
        return
      }
      let isValidPayload = false
      let block = new SECBlockChain.SECTokenBlock()
      block.setBlockHeaderFromBuffer(payload[0][0])
      while (requests.headers.length > 0) {
        const blockHash = requests.headers.shift()
        debug('Remote Block Header: ' + blockHash.toString('hex'))
        if (block.getBlockHeaderHash() === blockHash.toString('hex')) {
          // verify that the beneficiary is in this group
          let beneAddress = payload[0][1].toString('utf-8')
          let timestamp = Math.round(block.getBlockHeader().TimeStamp / 1000)
          let groupId = this.Consensus.secCircle.getTimestampWorkingGroupId(timestamp)
          let BeneGroupId = this.Consensus.secCircle.getTimestampGroupId(beneAddress, timestamp)
          if (groupId !== BeneGroupId) {
            debug(`not equal: groupId = ${groupId}, BeneGroupId = ${BeneGroupId}`)
            debug(`beneAddress = ${beneAddress}, timestamp = ${timestamp}`)
            debug(`DEBUG: BLOCK_HEADERS state: groupId = ${groupId}, BeneGroupId = ${BeneGroupId}`)
            debug(`DEBUG: BLOCK_HEADERS state: beneAddress = ${beneAddress}, timestamp = ${timestamp}`)
            break
          }

          isValidPayload = true
          setTimeout(() => {
            this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_BODIES, [Buffer.from('token', 'utf-8'), [blockHash]])
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
    debug('Get Block Hash: ' + blockHeaderHash)
    let localTokenBlockchain = this.BlockChain.SECTokenBlockChain.getBlockChain()
    let _block = localTokenBlockchain.filter(_block => _block.Hash === blockHeaderHash)[0]
    if (_block) {
      let localTokenBlock = new SECBlockChain.SECTokenBlock(_block)
      debug('Beneficiary: ' + _block.Beneficiary)
      bodies.push([localTokenBlock.getBlockBodyBuffer(), Buffer.from(_block.Beneficiary)])
    }
    this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_BODIES, [Buffer.from('token', 'utf-8'), bodies])

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
    while (requests.bodies.length > 0) {
      const block = requests.bodies.shift()
      block.setBlockBodyFromBuffer(payload[0][0])
      let _block = block.getBlock()
      debug('Remote Beneficiary: ' + payload[0][1].toString())
      _block.Beneficiary = payload[0][1].toString()
      let NewSECBlock = new SECBlockChain.SECTokenBlock(_block)
      let secblock = NewSECBlock.getBlock()
      secblock.Transactions = JSON.parse(JSON.stringify(secblock.Transactions))
      isValidPayload = true
      if (secblock.Number === this.BlockChain.SECTokenBlockChain.getCurrentHeight() + 1) {
        try {
          this.BlockChain.SECTokenBlockChain.putBlockToDB(secblock, () => {
            debug(chalk.green(`Get New Block from: ${this.addr} and saved in local Blockchain`))
            let newSECTokenBlock = new SECBlockChain.SECTokenBlock(secblock)
            this.Consensus.resetPOW()
            this._onNewBlock(newSECTokenBlock)
          })
        } catch (error) {
          debug('ERROR: token chain BLOCK_BODIES state, error occurs when writing new block to DB: ', error)
          // TODO: to be tested
          let NodeData = [
            SECDEVP2P._util.int2buffer(this.BlockChain.SECTokenBlockChain.getGenesisBlockDifficulty()),
            SECDEVP2P._util.int2buffer(this.BlockChain.SECTokenBlockChain.getCurrentHeight()),
            Buffer.from(this.BlockChain.SECTokenBlockChain.getLastBlockHash(), 'hex'),
            Buffer.from(this.BlockChain.SECTokenBlockChain.getGenesisBlockHash(), 'hex'),
            Buffer.from(JSON.stringify(this.BlockChain.SECTokenBlockChain.getHashList()))
          ]
          this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [Buffer.from('token', 'utf-8'), NodeData])
        }
      } else if (secblock.Number > this.BlockChain.SECTokenBlockChain.getCurrentHeight() + 1) {
        let NodeData = [
          SECDEVP2P._util.int2buffer(this.BlockChain.SECTokenBlockChain.getGenesisBlockDifficulty()),
          SECDEVP2P._util.int2buffer(this.BlockChain.SECTokenBlockChain.getCurrentHeight()),
          Buffer.from(this.BlockChain.SECTokenBlockChain.getLastBlockHash(), 'hex'),
          Buffer.from(this.BlockChain.SECTokenBlockChain.getGenesisBlockHash(), 'hex'),
          Buffer.from(JSON.stringify(this.BlockChain.SECTokenBlockChain.getHashList()))
        ]
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [Buffer.from('token', 'utf-8'), NodeData])
      } else {
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_NODE_DATA, [Buffer.from('token', 'utf-8'), []])
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
    payload.forEach(_payload => {
      let newTokenBlock = new SECBlockChain.SECTokenBlock()
      newTokenBlock.setBlockFromBuffer(_payload)
      if (!blocksCache.has(newTokenBlock.getBlockHeaderHash())) {
        let block = Object.assign({}, newTokenBlock.getBlock())
        try {
          this.BlockChain.SECTokenBlockChain.putBlockToDB(block, () => {
            console.log(chalk.green(`Sync New Block from: ${this.addr} and saved in local Blockchain`))
            blocksCache.set(newTokenBlock.getBlockHeaderHash(), true)
            this.Consensus.resetPOW()
          })
        } catch (error) {
          debug('ERROR: token chain BLOCK_BODIES state, error occurs when writing new block to DB: ', error)
          // TODO: to be tested, not sure
        }
      }
    })

    // this.BlockChain.SECTokenBlockChain.updateBlockchain(blockArray[0].Number, blockArray, (err) => {
    //   if (err) {
    //     debug('ERROR: token chain NEW_BLOCK state, updateBlockchain function callback error: ', err)
    //   } else {
    //     debug(blockArray.length + ' Blocks updated')
    //     debug('Update Token Blockchain Finished!')
    //     debug(`DEBUG: Update Token Blockchain Finished! block number is ${blockArray[0].Number}`)
    //     this.Consensus.resetPOW()
    //     this.BlockChain.TokenPool.updateByBlockChain(this.BlockChain.SECTokenBlockChain)
    //     debug(chalk.bold.yellow(`===== NEW_BLOCK End =====`))
    //   }
    // })

    // const isValidNewBlock = await this._isValidBlock(newTokenBlock)
    // if (isValidNewBlock) this._onNewBlock(newBlock, this.peer)
  }

  TX (payload, requests) {
    debug(chalk.bold.yellow(`===== TX =====`))
    if (!this.forkVerified) return

    for (let txBuffer of payload) {
      let TokenTx = new SECTransaction.SECTokenTx(txBuffer)
      if (this._isValidTx(TokenTx)) this._onNewTx(TokenTx)
    }
    debug(chalk.bold.yellow(`===== End TX =====`))
  }

  GET_NODE_DATA (payload, requests) {
    debug(chalk.bold.yellow(`===== GET_NODE_DATA =====`))
    let NodeData = [
      SECDEVP2P._util.int2buffer(this.BlockChain.SECTokenBlockChain.getGenesisBlockDifficulty()),
      SECDEVP2P._util.int2buffer(this.BlockChain.SECTokenBlockChain.getCurrentHeight()),
      Buffer.from(this.BlockChain.SECTokenBlockChain.getLastBlockHash(), 'hex'),
      Buffer.from(this.BlockChain.SECTokenBlockChain.getGenesisBlockHash(), 'hex'),
      Buffer.from(JSON.stringify(this.BlockChain.SECTokenBlockChain.getHashList()))
    ]
    this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [Buffer.from('token', 'utf-8'), NodeData])
    debug(chalk.bold.yellow(`===== End GET_NODE_DATA =====`))
  }

  NODE_DATA (payload, requests) {
    debug(chalk.bold.yellow(`===== NODE_DATA =====`))
    let localHeight = this.BlockChain.SECTokenBlockChain.getCurrentHeight()
    let localLastHash = this.BlockChain.SECTokenBlockChain.getLastBlockHash()
    let localHashList = this.BlockChain.SECTokenBlockChain.getHashList()
    let remoteHeight = SECDEVP2P._util.buffer2int(payload[1])
    let remoteLastHash = payload[2].toString('hex')
    let remoteHashList = JSON.parse(payload[4].toString())
    debug('local Height: ' + localHeight)
    debug('local Lasthash: ' + localLastHash)
    debug('remote Height: ' + remoteHeight)
    debug('remote Lasthash: ' + remoteLastHash)

    if (localHeight > remoteHeight) {
      debug('Local Token Blockchain Length longer than remote Node')
      let blockPosition = localHashList.filter(block => (block.Hash === remoteLastHash && block.Number === remoteHeight))
      if (blockPosition.length > 0) {
        debug('No Fork founded!')
        let newBlocks = this.BlockChain.SECTokenBlockChain.getBlockChain().slice(remoteHeight + 1)
        let newBlockBuffers = newBlocks.map(_block => {
          return new SECBlockChain.SECTokenBlock(_block).getBlockBuffer()
        })
        let syncBlockBuffers = _.chunk(newBlockBuffers, 100)
        syncBlockBuffers.forEach(_blockBuffer => {
          this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK, [Buffer.from('token', 'utf-8'), _blockBuffer])
        })
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
        let newBlocks = this.BlockChain.SECTokenBlockChain.getBlockChain().slice(forkPosition)
        let newBlockBuffers = newBlocks.map(_block => {
          return new SECBlockChain.SECTokenBlock(_block).getBlockBuffer()
        })
        let syncBlockBuffers = _.chunk(newBlockBuffers, 100)
        syncBlockBuffers.forEach(_blockBuffer => {
          this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK, [Buffer.from('token', 'utf-8'), _blockBuffer])
        })
      }
    }
    debug(chalk.bold.yellow(`===== End NODE_DATA =====`))
  }

  GET_RECEIPTS (payload, requests) {
    debug(chalk.bold.yellow(`===== GET_RECEIPTS =====`))
    this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.RECEIPTS, [Buffer.from('token', 'utf-8'), []])
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
    this.BlockChain.TokenPool.addTxIntoPool(tx.getTx())
    this.BlockChain.sendNewTokenTx(tx, this.peer)
    console.log(`New Token Tx: ${tx.getTx().TxHash} (from ${MainUtils.getPeerAddr(this.peer)})`)
  }

  _onNewBlock (newSECTokenBlock) {
    blocksCache.set(newSECTokenBlock.getBlockHeaderHash(), true)
    this.BlockChain.sendNewTokenBlockHash(newSECTokenBlock, this.peer)
    debug('----------------------------------------------------------------------------------------------------------')
    console.log(`New Token block ${newSECTokenBlock.getBlock().Number}: ${newSECTokenBlock.getBlock().Hash} (from ${MainUtils.getPeerAddr(this.peer)})`)
    debug('----------------------------------------------------------------------------------------------------------')
    this.BlockChain.TokenPool.updateByBlock(newSECTokenBlock.getBlock())
  }

  // TODO: must be reimplement
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
      debug(`ERROR: token chain, error on connection to node: ${err.stack || err}`)
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

module.exports = NetworkEvent