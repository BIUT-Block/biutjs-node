const chalk = require('chalk')
const ms = require('ms')
const async = require('async')
const LRUCache = require('lru-cache')
const SECConfig = require('../../config/default.json')
const util = require('util')
const createDebugLogger = require('debug')
const debug = createDebugLogger('core:network:token')

// -------------------------------  SEC LIBRARY  -------------------------------
const SECDEVP2P = require('@sec-block/secjs-devp2p')
const SECBlockChain = require('@sec-block/secjs-blockchain')
const SECTransaction = require('@sec-block/secjs-tx')

const MainUtils = require('../utils/utils')
const txCache = new LRUCache({ max: SECConfig.SECBlock.devp2pConfig.txCache })
const blocksCache = new LRUCache({ max: SECConfig.SECBlock.devp2pConfig.blocksCache })

const SYNC_CHUNK = 20 // each sync package contains 20 blocks

class NetworkEvent {
  constructor (config) {
    this.ID = config.ID
    this.BlockChain = config.BlockChain
    this.Consensus = config.Consensus
    this.NDP = config.NDP
    this.NodesIPSync = config.NodesIPSync

    // ---------------------------  CHECK PARAMETERS  --------------------------
    this.CHAIN_ID = SECConfig.SECBlock.checkConfig.CHAIN_ID
    this.CHECK_BLOCK_TITLE = SECConfig.SECBlock.checkConfig.CHECK_BLOCK_TITLE
    this.CHECK_BLOCK_NR = SECConfig.SECBlock.checkConfig.CHECK_BLOCK_NR

    // --------------------------------  Parameters  -------------------------------
    this.forkDrop = null
    this.forkVerified = false
    this.syncInfo = config.syncInfo
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
    this.BlockChain.SECTokenChain.getGenesisBlock((err, geneBlock) => {
      if (err) throw err
      else {
        this.BlockChain.SECTokenChain.getLastBlock((err, lastBlock) => {
          if (err) throw err
          else {
            let status = {
              networkId: this.CHAIN_ID,
              td: Buffer.from(geneBlock.Difficulty),
              bestHash: Buffer.from(lastBlock.Hash, 'hex'),
              genesisHash: Buffer.from(geneBlock.Hash, 'hex')
            }
            debug(chalk.bold.yellowBright('Sending Local Status to Peer...'))
            debug(status)
            this.sec.sendStatus(status)
          }
        })
      }
    })

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

        case SECDEVP2P.SEC.MESSAGE_CODES.NODES_IP_SYNC:
          this.NODES_IP_SYNC(payload, requests)
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
      this.BlockChain.SECTokenChain.getBlocksWithHash(blockHeaderHash, (err, blockArray) => {
        if (err) throw err
        else {
          if (blockArray.length > 0) {
            let localTokenBlock = new SECBlockChain.SECTokenBlock(blockArray[0])
            headers.push(localTokenBlock.getHeaderBuffer())

            debug('SEC Send Message: BLOCK_HEADERS')
            this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_HEADERS, [Buffer.from('token', 'utf-8'), headers])
          } else {
            debug(`BLOCK_HEADERS: block header with hash ${blockHeaderHash} is not found`)
          }
        }
      })
    } else {
      debug('REMOTE CHECK_BLOCK_NR: ' + SECDEVP2P._util.buffer2int(payload[0]))
      if (SECDEVP2P._util.buffer2int(payload[0]) === this.CHECK_BLOCK_NR) {
        this.BlockChain.SECTokenChain.getBlock(this.CHECK_BLOCK_NR - 1, (err, block) => {
          if (err) throw err
          else {
            let checkBlock = new SECBlockChain.SECTokenBlock(block)
            headers.push(checkBlock.getHeaderBuffer())
            debug('REMOTE CHECK_BLOCK_HEADER: ')
            debug(util.inspect(checkBlock.getHeaderBuffer(), false, null))

            debug('SEC Send Message: BLOCK_HEADERS')
            this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_HEADERS, [Buffer.from('token', 'utf-8'), headers])
          }
        })
      }
    }

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
      this.BlockChain.SECTokenChain.getGenesisBlock((err, geneBlock) => {
        if (err) throw err
        else {
          debug(`Expected Hash: ${geneBlock.Hash}`)
          let block = new SECBlockChain.SECTokenBlock()
          block.setHeader(payload[0])
          debug(`Remote Header Hash: ${block.getHeaderHash()}`)
          if (block.getHeaderHash() === geneBlock.Hash) {
            debug(`${this.addr} verified to be on the same side of the ${this.CHECK_BLOCK_TITLE}`)
            clearTimeout(this.forkDrop)
            this.forkVerified = true
            debug(`forkVerified: ${this.forkVerified}`)
            this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_NODE_DATA, [Buffer.from('token', 'utf-8'), []])
            this._addPeerToNDP()
            this._startSyncNodesIP()
          }
        }
      })
    } else {
      if (payload.length > 1) {
        debug(`${this.addr} not more than one block header expected (received: ${payload.length})`)
        return
      }
      let block = new SECBlockChain.SECTokenBlock()
      block.setHeader(payload[0])
      while (requests.headers.length > 0) {
        const blockHash = requests.headers.shift()
        debug('Remote Block Header: ' + blockHash.toString('hex'))
        if (block.getHeaderHash() === blockHash.toString('hex')) {
          // verify that the beneficiary is in this group
          let beneAddress = block.getHeader().Beneficiary
          let timestamp = block.getHeader().TimeStamp
          let groupId = this.Consensus.secCircle.getTimestampWorkingGroupId(timestamp)
          let BeneGroupId = this.Consensus.secCircle.getTimestampGroupId(beneAddress, timestamp)
          if (groupId !== BeneGroupId) {
            debug(`not equal: groupId = ${groupId}, BeneGroupId = ${BeneGroupId}`)
            debug(`beneAddress = ${beneAddress}, timestamp = ${timestamp}`)
            debug(`DEBUG: BLOCK_HEADERS state: groupId = ${groupId}, BeneGroupId = ${BeneGroupId}`)
            debug(`DEBUG: BLOCK_HEADERS state: beneAddress = ${beneAddress}, timestamp = ${timestamp}`)
            break
          }

          // verify block number
          if (block.getHeader().Number <= this.BlockChain.SECTokenChain.getCurrentHeight()) {
            // immediately break if block height is incorrect
            break
          }

          // verify parent block hash
          let parentHash = block.getHeader().ParentHash
          this.BlockChain.SECTokenChain.getBlock(block.getHeader().Number - 1, (err, lastBlock) => {
            if (err) return
            if (lastBlock.Hash === parentHash) {
              setTimeout(() => {
                this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_BODIES, [Buffer.from('token', 'utf-8'), [blockHash]])
                requests.bodies.push(block)
              }, ms('0.1s'))
            } else {
              let newBlockNumber = block.getHeader().Number
              let localHeight = this.BlockChain.SECTokenChain.getCurrentHeight()
              if (newBlockNumber === localHeight + 1) {
                // do nothing if two blockchains with the same length are forked
              } else if (newBlockNumber > localHeight + 1) {
                // if remote node has more blocks than local
                this.BlockChain.SECTokenChain.getHashList((err, hashList) => {
                  if (err) throw err
                  else {
                    this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [Buffer.from('token', 'utf-8'), Buffer.from(JSON.stringify(hashList))])
                  }
                })
              } else {
                // if local db has more blocks than remote node
                this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_NODE_DATA, [Buffer.from('token', 'utf-8'), []])
              }
            }
          })
        }
      }
    }
    debug(chalk.bold.yellow(`===== End BLOCK_HEADERS =====`))
  }

  GET_BLOCK_BODIES (payload, requests) {
    debug(chalk.bold.yellow(`===== GET_BLOCK_BODIES =====`))

    let bodies = []
    let blockHeaderHash = payload[0].toString('hex')
    debug('Get Block Hash: ' + blockHeaderHash)
    this.BlockChain.SECTokenChain.getBlocksWithHash(blockHeaderHash, (err, blockArray) => {
      if (err) throw err
      else {
        if (blockArray.length > 0) {
          let localTokenBlock = new SECBlockChain.SECTokenBlock(blockArray[0])
          debug('Beneficiary: ' + blockArray[0].Beneficiary)
          bodies.push(SECDEVP2P._util.int2buffer(blockArray[0].Number))
          bodies.push(localTokenBlock.getBodyBuffer())
        }
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_BODIES, [Buffer.from('token', 'utf-8'), bodies])
      }
    })
    debug(chalk.bold.yellow(`===== End GET_BLOCK_BODIES =====`))
  }

  BLOCK_BODIES (payload, requests) {
    debug(chalk.bold.yellow(`===== BLOCK_BODIES =====`))
    if (!this.forkVerified) return

    while (requests.bodies.length > 0) {
      const block = requests.bodies.shift()
      if (block.getHeader().Number !== SECDEVP2P._util.buffer2int(payload[0])) {
        break
      }

      if (this.syncInfo.flag) {
        break
      }

      block.setBody(payload[1])
      let _block = block.getBlock()
      debug('Remote Beneficiary: ' + _block.Beneficiary)
      let NewSECBlock = new SECBlockChain.SECTokenBlock(_block)
      let secblock = NewSECBlock.getBlock()
      secblock.Transactions = JSON.parse(JSON.stringify(secblock.Transactions))

      try {
        this.BlockChain.SECTokenChain.putBlockToDB(secblock, (err) => {
          if (err) throw err
          else {
            debug(chalk.green(`Get New Block from: ${this.addr} and saved in local Blockchain, block Number: ${secblock.Number}`))
            let newSECTokenBlock = new SECBlockChain.SECTokenBlock(secblock)
            this.Consensus.resetPOW()
            this._onNewBlock(newSECTokenBlock)
          }
        })
      } catch (error) {
        debug('ERROR: token chain BLOCK_BODIES state, error occurs when writing new block to DB: ', error)
      }
    }
    debug(chalk.bold.yellow(`===== End BLOCK_BODIES =====`))
  }

  NEW_BLOCK (payload, requests) {
    debug(chalk.bold.yellow(`===== NEW_BLOCK =====`))
    if (!this.forkVerified) return
    let remoteHeight = SECDEVP2P._util.buffer2int(payload[0])
    let remoteAddress = payload[2].toString('hex')

    if (this.syncInfo.flag) {
      if (this.syncInfo.address !== remoteAddress) return
    } else {
      this.syncInfo.flag = true
      this.syncInfo.address = remoteAddress
    }
    this.syncInfo.timer = setTimeout(() => {
      this.syncInfo.flag = false
      this.syncInfo.address = null
    }, ms('15s'))

    let firstTokenBlock = new SECBlockChain.SECTokenBlock(payload[1][0])
    this.BlockChain.SECTokenChain.delBlockFromHeight(firstTokenBlock.getHeader().Number, (err, txArray) => {
      if (err) throw err
      async.eachSeries(payload[1], (_payload, callback) => {
        let newTokenBlock = new SECBlockChain.SECTokenBlock(_payload)
        if (!blocksCache.has(newTokenBlock.getHeaderHash())) {
          let block = Object.assign({}, newTokenBlock.getBlock())
          this.BlockChain.SECTokenChain.putBlockToDB(block, (err) => {
            if (err) callback(err)
            else {
              console.log(chalk.green(`Sync New Block from: ${this.addr} with height ${block.Number} and saved in local Blockchain`))
              blocksCache.set(newTokenBlock.getHeaderHash(), true)
              this.Consensus.resetPOW()

              this.BlockChain.tokenPool.updateByBlock(block)
              callback()
            }
          })
        }
      }, (err) => {
        if (err) throw err
        else {
          this.BlockChain.SECTokenChain.getHashList((err, hashList) => {
            if (err) throw err
            else if (this.BlockChain.SECTokenChain.getCurrentHeight() < remoteHeight) {
              this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [Buffer.from('token', 'utf-8'), Buffer.from(JSON.stringify(hashList))])
            } else {
              this.syncInfo.flag = false
              this.syncInfo.address = null
              clearTimeout(this.syncInfo)
            }
          })
        }
      })

      // if (txArray) {
      //   txArray.forEach(tx => {
      //     this.BlockChain.tokenPool.addTxIntoPool(tx)
      //   })
      // }
    })
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
    this.BlockChain.SECTokenChain.getHashList((err, hashList) => {
      if (err) throw err
      else {
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [Buffer.from('token', 'utf-8'), Buffer.from(JSON.stringify(hashList))])
      }
    })
    debug(chalk.bold.yellow(`===== End GET_NODE_DATA =====`))
  }

  NODE_DATA (payload, requests) {
    debug(chalk.bold.yellow(`===== NODE_DATA =====`))
    let remoteHashList = JSON.parse(payload.toString())
    let remoteHeight = remoteHashList[remoteHashList.length - 1].Number
    let remoteLastHash = remoteHashList[remoteHashList.length - 1].Hash

    let localHeight = this.BlockChain.SECTokenChain.getCurrentHeight()
    debug('local Height: ' + localHeight)
    debug('remote Height: ' + remoteHeight)
    debug('remote Lasthash: ' + remoteLastHash)

    this.BlockChain.SECTokenChain.getHashList((err, hashList) => {
      if (err) throw err
      else {
        if (localHeight > remoteHeight) {
          debug('Local Token Blockchain Length longer than remote Node')
          let blockPosition = hashList.filter(block => (block.Hash === remoteLastHash && block.Number === remoteHeight))
          if (blockPosition.length > 0) {
            debug('No Fork founded!')
            // send 'SYNC_CHUNK' blocks to remote node
            this.BlockChain.SECTokenChain.getBlocksFromDB(remoteHeight + 1, remoteHeight + SYNC_CHUNK, (err, newBlocks) => {
              if (err) throw err
              else {
                let blockBuffer = newBlocks.map(_block => {
                  return new SECBlockChain.SECTokenBlock(_block).getBlockBuffer()
                })

                let sentMsg = [
                  SECDEVP2P._util.int2buffer(localHeight), // local chain height
                  blockBuffer,
                  Buffer.from(this.BlockChain.SECAccount.getAddress(), 'hex') // local wallet address
                ]
                this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK, [Buffer.from('token', 'utf-8'), sentMsg])
              }
            })
          } else {
            debug('Fork founded!')
            let forkPosition = 0
            for (let i = remoteHeight - 1; i >= 1; i--) {
              if (hashList.filter(block => (block.Hash === remoteHashList[i].Hash)).length > 0) {
                forkPosition = remoteHashList[i].Number + 1
                debug('Fork Position: ' + forkPosition)
                break
              }
            }
            this.BlockChain.SECTokenChain.getBlocksFromDB(forkPosition, forkPosition + SYNC_CHUNK, (err, newBlocks) => {
              if (err) throw err
              else {
                let blockBuffer = newBlocks.map(_block => {
                  return new SECBlockChain.SECTokenBlock(_block).getBlockBuffer()
                })

                let sentMsg = [
                  SECDEVP2P._util.int2buffer(localHeight), // local chain height
                  blockBuffer,
                  Buffer.from(this.BlockChain.SECAccount.getAddress(), 'hex') // local wallet address
                ]
                debug(`Send blocks from ${forkPosition} to ${forkPosition + SYNC_CHUNK}, newBlocks length: ${newBlocks}`)
                this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK, [Buffer.from('token', 'utf-8'), sentMsg])
              }
            })
          }
        }
      }
      debug(chalk.bold.yellow(`===== End NODE_DATA =====`))
    })
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

  NODES_IP_SYNC (payload, requests) {
    try {
      let nodes = JSON.parse(payload.toString())
      this.NodesIPSync.updateNodesTable(nodes)
    } catch (err) {
      console.error(err)
    }
  }

  _onNewTx (tx) {
    const txHashHex = tx.getTxHash()
    if (txCache.has(txHashHex)) return
    txCache.set(txHashHex, true)

    this.BlockChain.isTokenTxExist(tx.getTxHash(), (err, result) => {
      if (err) throw err
      else if (!result) this.BlockChain.tokenPool.addTxIntoPool(tx.getTx())
    })

    this.BlockChain.sendNewTokenTx(tx, this.peer)
    console.log(`New Token Tx: ${tx.getTx().TxHash} (from ${MainUtils.getPeerAddr(this.peer)})`)
  }

  _onNewBlock (newSECTokenBlock) {
    blocksCache.set(newSECTokenBlock.getHeaderHash(), true)
    this.BlockChain.sendNewTokenBlockHash(newSECTokenBlock, this.peer)
    debug('----------------------------------------------------------------------------------------------------------')
    console.log(`New Token block ${newSECTokenBlock.getBlock().Number}: ${newSECTokenBlock.getBlock().Hash} (from ${MainUtils.getPeerAddr(this.peer)})`)
    debug('----------------------------------------------------------------------------------------------------------')
    this.BlockChain.tokenPool.updateByBlock(newSECTokenBlock.getBlock())
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

  _startSyncNodesIP () {
    setInterval(() => {
      let _peers = []
      if (this.NodesIPSync.getNodesTable().length === 0) {
        let peers = this.NDP.getPeers()
        peers.forEach(peer => {
          _peers.push({
            id: peer.id.toString('hex'),
            address: peer.address,
            udpPort: peer.udpPort,
            tcpPort: peer.tcpPort
          })
        })
      } else {
        _peers = this.NodesIPSync.getNodesTable()
      }
      this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODES_IP_SYNC, [Buffer.from('token', 'utf-8'), Buffer.from(JSON.stringify(_peers))])
    }, 120000)
  }
}

module.exports = NetworkEvent
