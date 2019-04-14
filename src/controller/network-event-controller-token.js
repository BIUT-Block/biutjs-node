const _ = require('lodash')
const chalk = require('chalk')
const ms = require('ms')
const async = require('async')
const LRUCache = require('lru-cache')
const SECConfig = require('../../config/default.json')
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
const TOKEN_CHAIN = Buffer.from('token', 'utf-8')

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
      if (err) console.error(`Error: ${err}`)
      else {
        this.BlockChain.SECTokenChain.getLastBlock((err, lastBlock) => {
          if (err) console.error(`Error: ${err}`)
          else {
            let status = {
              networkId: this.CHAIN_ID,
              td: Buffer.from(geneBlock.Difficulty),
              bestHash: Buffer.from(lastBlock.Hash, 'hex'),
              genesisHash: Buffer.from(geneBlock.Hash, 'hex')
            }
            debug(chalk.bold.yellowBright('Sending Local Status to Peer...'))
            debug(status)
            try {
              this.sec.sendStatus(status)
            } catch (e) {
              // do nothing
            }
          }
        })
      }
    })

    // ------------------------------  CHECK FORK  -----------------------------
    this.sec.once('status', () => {
      debug('Running first time Status Check...')
      this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_HEADERS, [TOKEN_CHAIN, this.CHECK_BLOCK_NR])
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
      // debug('Requests: ')
      // debug(requests)
      // debug('Code: ' + code)
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

    // new block hash received from a remote node
    let blockHash = payload.toString('hex')
    debug(`New Block Hash from Remote: ${blockHash}`)

    this.BlockChain.SECTokenChain.getHashList((err, hashList) => {
      if (err) console.error(`Error: ${err}`)
      else if (blockHash in hashList) {
        // skip if the block is already in the database
      } else if (blocksCache.has(blockHash)) {
        // skip if the hash is already in the block cache
        debug('Block Hash already existed in Cache')
      } else {
        blocksCache.set(blockHash, true)
        setTimeout(() => {
          blocksCache.del(blockHash)
        }, ms('5s'))

        debug('Send GET_BLOCK_HEADERS Message')
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_HEADERS, [TOKEN_CHAIN, payload])
        requests.headers.push(blockHash)
      }
    })
    debug(chalk.bold.yellow(`===== End NEW_BLOCK_HASHES End =====`))
  }

  GET_BLOCK_HEADERS (payload, requests) {
    debug(chalk.bold.yellow(`===== GET_BLOCK_HEADERS =====`))
    if (!this.forkVerified) {
      // check genesis block
      debug('REMOTE CHECK_BLOCK_NR: ' + SECDEVP2P._util.buffer2int(payload))
      if (SECDEVP2P._util.buffer2int(payload) === this.CHECK_BLOCK_NR) {
        this.BlockChain.SECTokenChain.getBlock(this.CHECK_BLOCK_NR - 1, (err, block) => {
          if (err) console.error(`Error: ${err}`)
          else {
            let checkBlock = new SECBlockChain.SECTokenBlock(block)

            debug('SEC Send Message: BLOCK_HEADERS genesis block')
            this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_HEADERS, [TOKEN_CHAIN, checkBlock.getHeaderBuffer()])
          }
        })
      }
    } else {
      let blockHash = payload.toString('hex')
      debug('Get Block Hash: ' + blockHash)
      this.BlockChain.SECTokenChain.getBlocksWithHash(blockHash, (err, blockArray) => {
        if (err) console.error(`Error: ${err}`)
        else {
          if (blockArray.length > 0) {
            let localBlock = new SECBlockChain.SECTokenBlock(blockArray[0])

            debug('SEC Send Message: BLOCK_HEADERS')
            this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_HEADERS, [TOKEN_CHAIN, localBlock.getHeaderBuffer()])
          } else {
            debug(`BLOCK_HEADERS: block header with hash ${blockHash} is not found`)
          }
        }
      })
    }

    debug(chalk.bold.yellow(`===== End GET_BLOCK_HEADERS =====`))
  }

  BLOCK_HEADERS (payload, requests) {
    debug(chalk.bold.yellow(`===== BLOCK_HEADERS =====`))
    let block = new SECBlockChain.SECTokenBlock()
    block.setHeader(payload)
    debug(`Received block header: ${JSON.stringify(block.getHeader())}`)

    if (!this.forkVerified) {
      this.BlockChain.SECTokenChain.getGenesisBlock((err, geneBlock) => {
        if (err) console.error(`Error: ${err}`)
        else if (block.getHeaderHash() === geneBlock.Hash) {
          debug(`${this.addr} verified to be on the same side of the ${this.CHECK_BLOCK_TITLE}`)
          this.forkVerified = true
          clearTimeout(this.forkDrop)
          this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_NODE_DATA, [TOKEN_CHAIN, []])

          this._addPeerToNDP()
          this._startSyncNodesIP()
        } else {
          debug(`${this.addr} is NOT on the same side of the ${this.CHECK_BLOCK_TITLE}`)
          debug(`Expected Hash: ${geneBlock.Hash}, Remote Hash: ${block.getHeaderHash()}`)
        }
      })
    } else {
      if (requests.headers.indexOf(block.getHeaderHash()) > -1) {
        // remove it from requests.headers
        requests.headers.splice(requests.headers.indexOf(block.getHeaderHash()), 1)
        let header = block.getHeader()

        // verify beneficiary group id and block number
        if (!this._isValidBlock(header)) {
          return
        }

        // verify parent block hash
        this.BlockChain.SECTokenChain.getBlock(header.Number - 1, (err, lastBlock) => {
          if (err) {
            // possible reason: block does not exist because received block number is larger than local chain length at least by 2
            debug(`error occurs when verify parent hash: ${err}`)
            this.BlockChain.SECTokenChain.getHashList((err, hashList) => {
              if (err) console.error(`Error: ${err}`)
              else {
                debug(`getBlock() function error condition: hash list is ${hashList}`)
                this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [TOKEN_CHAIN, Buffer.from(JSON.stringify(hashList))])
              }
            })
          } else {
            // case 1: parent hash successfully verified
            if (lastBlock.Hash === header.ParentHash) {
              debug(`parent hash successfully verified`)
              this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_BODIES, [TOKEN_CHAIN, Buffer.from(block.getHeaderHash(), 'hex')])
              requests.bodies.push(block)
              debug(`BLOCK_HEADERS2: ${JSON.stringify(header)}`)
            } else {
              debug('parent hash verification failed')
              let localHeight = this.BlockChain.SECTokenChain.getCurrentHeight()
              if (header.Number === localHeight) {
                // case 2: parent hash verification failed, local node has a forked chain and the chain has the same length as remote node chain
                debug('do nothing if two blockchains with the same length are forked')
              } else if (header.Number > localHeight) {
                // case 3: parent hash verification failed, remote node chain is longer than local chain
                debug(`remote node has more blocks than local`)
                this.BlockChain.SECTokenChain.getHashList((err, hashList) => {
                  if (err) console.error(`Error: ${err}`)
                  else {
                    debug(`Parent hash verification failed, remote node has longer chain than local, hash list: ${hashList}`)
                    this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [TOKEN_CHAIN, Buffer.from(JSON.stringify(hashList))])
                  }
                })
              } else {
                // case 3: parent hash verification failed, remote node chain is shorter than local chain
                debug('local db has more blocks than remote node')
                this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_NODE_DATA, [TOKEN_CHAIN, []])
              }
            }
          }
        })
      } else {
        debug(`Received block header hash ${block.getHeaderHash()} is not in requests.headers: ${requests.headers}`)
      }
    }
    debug(chalk.bold.yellow(`===== End BLOCK_HEADERS =====`))
  }

  GET_BLOCK_BODIES (payload, requests) {
    debug(chalk.bold.yellow(`===== GET_BLOCK_BODIES =====`))

    let blockHash = payload.toString('hex')
    debug('Get Block Hash: ' + blockHash)
    this.BlockChain.SECTokenChain.getBlocksWithHash(blockHash, (err, blockArray) => {
      if (err) console.error(`Error: ${err}`)
      else {
        let bodies = []
        if (blockArray.length > 0) {
          let localTokenBlock = new SECBlockChain.SECTokenBlock(blockArray[0])
          debug('Beneficiary: ' + blockArray[0].Beneficiary)
          bodies.push(SECDEVP2P._util.int2buffer(blockArray[0].Number))
          bodies.push(localTokenBlock.getBodyBuffer())
        }
        debug(`Send BLOCK_BODIES, get block with hash result: ${blockArray[0]}`)
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_BODIES, [TOKEN_CHAIN, bodies])
      }
    })
    debug(chalk.bold.yellow(`===== End GET_BLOCK_BODIES =====`))
  }

  BLOCK_BODIES (payload, requests) {
    debug(chalk.bold.yellow(`===== BLOCK_BODIES =====`))
    if (!this.forkVerified) return

    for (let [index, block] of requests.bodies.entries()) {
      debug(`BLOCK_BODIES: block in requests.bodies: ${JSON.stringify(block.getHeader())}`)

      // find the corresponding block stored in requests.bodies
      if (block.getHeader().Number !== SECDEVP2P._util.buffer2int(payload[0])) {
        debug(`block number in requests.bodies is unequal to the block number received from remote node`)
        break
      }
      requests.bodies.splice(index, 1)

      // Check if the node is syncronizing blocks from other nodes
      if (this.syncInfo.flag) {
        debug(`local node is in synchronizing`)
        break
      }

      block.setBody(payload[1])
      if (!block.verifyTxRoot()) {
        debug('Failed to verify transaction root')
        break
      }

      let secblock = block.getBlock()
      debug(`block data after set body: ${JSON.stringify(secblock)}`)

      this.BlockChain.SECTokenChain.putBlockToDB(secblock, (err) => {
        if (err) console.error(`Error: ${err}`)
        else {
          debug(`Get New Block from: ${this.addr} and saved in local Blockchain, block Number: ${secblock.Number}, block Hash: ${secblock.Hash}`)
          let newSECTokenBlock = new SECBlockChain.SECTokenBlock(secblock)
          this.Consensus.resetPOW()
          this._onNewBlock(newSECTokenBlock)
        }
      })
    }
    debug(chalk.bold.yellow(`===== End BLOCK_BODIES =====`))
  }

  NEW_BLOCK (payload, requests) {
    debug(chalk.bold.yellow(`===== NEW_BLOCK =====`))
    if (!this.forkVerified) return

    let remoteHeight = SECDEVP2P._util.buffer2int(payload[0])
    let remoteAddress = payload[2].toString('hex')

    // Check if the node is syncronizing blocks from other nodes
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

    let firstBlockNum = new SECBlockChain.SECTokenBlock(payload[1][0]).getHeader().Number
    debug(`Start syncronizing multiple blocks, first block's height is: ${firstBlockNum}, ${payload[1].length} blocks synced`)

    // remove all the blocks which have a larger block number than the first block to be syncronized
    this.BlockChain.SECTokenChain.delBlockFromHeight(firstBlockNum, (err, txArray) => {
      if (err) console.error(`Error: ${err}`)
      async.eachSeries(payload[1], (_payload, callback) => {
        let newTokenBlock = new SECBlockChain.SECTokenBlock(_payload)
        let block = Object.assign({}, newTokenBlock.getBlock())
        debug(`Syncronizing block ${block.Number}`)
        this.BlockChain.SECTokenChain.putBlockToDB(block, (err) => {
          if (err) callback(err)
          else {
            console.log(chalk.green(`Sync New Block from: ${this.addr} with height ${block.Number} and saved in local Blockchain`))
            debug(`Sync New Block from: ${this.addr} with height ${block.Number} and saved in local Blockchain`)
            this.Consensus.resetPOW()

            this.BlockChain.tokenPool.updateByBlock(block)
            callback()
          }
        })
      }, (err) => {
        if (err) console.error(`Error: ${err}`)
        else {
          // remove the duplicated txs
          _.remove(txArray, (tx) => {
            this.BlockChain.checkBalance(tx, (err, balResult) => {
              if (err) {
                return true
              } else {
                this.BlockChain.isTokenTxExist(tx.TxHash, (err, exiResult) => {
                  if (err) return true
                  else {
                    return (exiResult || !balResult)
                  }
                })
              }
            })
          })

          // add the removed txs into pool
          txArray.forEach((tx) => {
            this.BlockChain.tokenPool.addTxIntoPool(tx)
          })

          if (this.BlockChain.SECTokenChain.getCurrentHeight() >= remoteHeight) {
            // synchronizing finished
            this.syncInfo.flag = false
            this.syncInfo.address = null
            clearTimeout(this.syncInfo)
          } else {
            // continue synchronizing
            this.BlockChain.SECTokenChain.getHashList((err, hashList) => {
              if (err) console.error(`Error: ${err}`)
              else {
                this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [TOKEN_CHAIN, Buffer.from(JSON.stringify(hashList))])
              }
            })
          }
        }
      })
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
      if (err) console.error(`Error: ${err}`)
      else {
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [TOKEN_CHAIN, Buffer.from(JSON.stringify(hashList))])
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
      if (err) console.error(`Error: ${err}`)
      else if (localHeight > remoteHeight) {
        // Local chain is longer than remote chain
        debug('Local Token Blockchain Length longer than remote Node')
        let blockPosition = hashList.filter(block => (block.Hash === remoteLastHash && block.Number === remoteHeight))
        if (blockPosition.length > 0) {
          // No fork found, send 'SYNC_CHUNK' blocks to remote node
          debug('No Fork found!')
          this.BlockChain.SECTokenChain.getBlocksFromDB(remoteHeight + 1, remoteHeight + SYNC_CHUNK, (err, newBlocks) => {
            if (err) console.error(`Error: ${err}`)
            else {
              let blockBuffer = newBlocks.map(_block => {
                return new SECBlockChain.SECTokenBlock(_block).getBlockBuffer()
              })

              let sentMsg = [
                SECDEVP2P._util.int2buffer(localHeight), // local chain height
                blockBuffer,
                Buffer.from(this.BlockChain.SECAccount.getAddress(), 'hex') // local wallet address
              ]
              debug(`Send blocks from ${remoteHeight + 1} to ${remoteHeight + SYNC_CHUNK}, newBlocks length: ${newBlocks.length}`)
              this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK, [TOKEN_CHAIN, sentMsg])
            }
          })
        } else {
          debug('Fork found!')

          // find fork position
          let forkPosition = 0
          for (let i = remoteHeight - 1; i >= 1; i--) {
            if (hashList.filter(block => (block.Hash === remoteHashList[i].Hash)).length > 0) {
              forkPosition = remoteHashList[i].Number + 1
              debug('Fork Position: ' + forkPosition)
              break
            }
          }

          // send 'SYNC_CHUNK' blocks to remote node
          this.BlockChain.SECTokenChain.getBlocksFromDB(forkPosition, forkPosition + SYNC_CHUNK, (err, newBlocks) => {
            if (err) console.error(`Error: ${err}`)
            else {
              let blockBuffer = newBlocks.map(_block => {
                return new SECBlockChain.SECTokenBlock(_block).getBlockBuffer()
              })

              let sentMsg = [
                SECDEVP2P._util.int2buffer(localHeight), // local chain height
                blockBuffer,
                Buffer.from(this.BlockChain.SECAccount.getAddress(), 'hex') // local wallet address
              ]
              debug(`Send blocks from ${forkPosition} to ${forkPosition + SYNC_CHUNK}, newBlocks length: ${newBlocks.length}`)
              this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK, [TOKEN_CHAIN, sentMsg])
            }
          })
        }
      } else {
        debug('remote blockchain is longer than local blockchain')
        // do nothing if remote node blockchain is longer than local blockchain
      }
      debug(chalk.bold.yellow(`===== End NODE_DATA =====`))
    })
  }

  GET_RECEIPTS (payload, requests) {
    debug(chalk.bold.yellow(`===== GET_RECEIPTS =====`))
    this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.RECEIPTS, [TOKEN_CHAIN, []])
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

  syncFromIp (ip, callback) {
    this.BlockChain.SECTokenChain.getGenesisBlock((err, geneBlock) => {
      if (err) callback(err)
      else {
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [TOKEN_CHAIN, Buffer.from(JSON.stringify([geneBlock]))])
        callback()
      }
    })
  }

  _onNewTx (tx) {
    const txHashHex = tx.getTxHash()
    if (txCache.has(txHashHex)) return
    txCache.set(txHashHex, true)

    this.BlockChain.isTokenTxExist(tx.getTxHash(), (err, result) => {
      if (err) console.error(`Error: ${err}`)
      else if (!result) {
        this.BlockChain.tokenPool.addTxIntoPool(tx.getTx())
      }
    })

    this.BlockChain.sendNewTokenTx(tx, this.peer)
    console.log(`New Token Tx: ${tx.getTx().TxHash} (from ${MainUtils.getPeerAddr(this.peer)})`)
  }

  _onNewBlock (newSECTokenBlock) {
    this.BlockChain.sendNewTokenBlockHash(newSECTokenBlock, this.peer)
    debug('----------------------------------------------------------------------------------------------------------')
    console.log(`New Token block ${newSECTokenBlock.getBlock().Number}: ${newSECTokenBlock.getBlock().Hash} (from ${MainUtils.getPeerAddr(this.peer)})`)
    debug('----------------------------------------------------------------------------------------------------------')
    this.BlockChain.tokenPool.updateByBlock(newSECTokenBlock.getBlock())
  }

  _isValidBlock (blockHeader) {
    // verify that the beneficiary is in the corresponding group
    let beneAddress = blockHeader.Beneficiary
    let timestamp = blockHeader.TimeStamp
    let groupId = this.Consensus.secCircle.getTimestampWorkingGroupId(timestamp)
    let BeneGroupId = this.Consensus.secCircle.getTimestampGroupId(beneAddress, timestamp)
    if (groupId !== BeneGroupId) {
      debug(`ERROR: BLOCK_HEADERS state: groupId = ${groupId}, BeneGroupId = ${BeneGroupId}`)
      return false
    }

    // verify block number
    if (blockHeader.Number <= this.BlockChain.SECTokenChain.getCurrentHeight()) {
      // immediately break if block height is incorrect
      debug(`Error: new block number ${blockHeader.Number} is smaller than local chain height: ${this.BlockChain.SECTokenChain.getCurrentHeight()}`)
      return false
    }

    return true
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
      this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODES_IP_SYNC, [TOKEN_CHAIN, Buffer.from(JSON.stringify(_peers))])
    }, 120000)
  }
}

module.exports = NetworkEvent
