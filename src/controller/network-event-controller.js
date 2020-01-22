const chalk = require('chalk')
const ms = require('ms')
const async = require('async')
const cloneDeep = require('clone-deep')
const LRUCache = require('lru-cache')
const zlib = require('zlib')
const SECConfig = require('../../config/default.json')
const createDebugLogger = require('debug')
const debug = createDebugLogger('core:network')

// -------------------------------  SEC LIBRARY  -------------------------------
const SECDEVP2P = require('@biut-block/biutjs-devp2p')
const SECBlockChain = require('@biut-block/biutjs-blockchain')
const SECTransaction = require('@biut-block/biutjs-tx')

const MainUtils = require('../utils/utils')
const txCache = new LRUCache({ max: SECConfig.SECBlock.devp2pConfig.txCache })
const blocksCache = new LRUCache({ max: SECConfig.SECBlock.devp2pConfig.blocksCache })

const SYNC_CHUNK = 20 // each sync package contains 20 blocks

class NetworkEvent {
  constructor (config) {
    this.ID = config.ID
    this.logger = config.logger
    this.BlockChain = config.BlockChain
    this.Consensus = config.BlockChain.consensus
    this.NDP = config.NDP
    this.NodesIPSync = config.NodesIPSync
    this.ChainID = config.ChainID
    this.ChainIDBuff = Buffer.from(config.ChainID)
    this.ChainName = config.ChainName
    this.ChainNameBuff = Buffer.from(config.ChainName)

    // ---------------------------  CHECK PARAMETERS  --------------------------
    let netType = process.env.netType
    this.NETWORK_ID = netType === 'main' ? 4 : netType === 'test' ? 2 : netType === 'develop' ? 3 : 4
    this.logger.info(`Working at '${netType}' network, ChainID: ${this.ChainID}, NetworkID: ${this.NETWORK_ID}`)
    console.log(`Working at '${netType}' network, ChainID: ${this.ChainID}, NetworkID: ${this.NETWORK_ID}`)
    this.CHECK_BLOCK_TITLE = SECConfig.SECBlock.checkConfig.CHECK_BLOCK_TITLE
    this.CHECK_BLOCK_NR = SECConfig.SECBlock.checkConfig.CHECK_BLOCK_NR

    // --------------------------------  Parameters  -------------------------------
    this.forkDrop = null
    this.forkVerified = false
    this.syncingFlag = false
    this.syncInfo = config.syncInfo
    this.syncListeningTimer = {}
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
    this.BlockChain.chain.getGenesisBlock((err, geneBlock) => {
      if (err) {
        this.logger.error(`Error in network.js, PeerCommunication function, getGenesisBlock: ${err}`)
        console.error(`Error in network.js, PeerCommunication function, getGenesisBlock: ${err}`)
      } else {
        this.BlockChain.chain.getLastBlock((err, lastBlock) => {
          if (err) {
            this.logger.error(`Error in network.js, PeerCommunication function, getLastBlock: ${err}`)
            console.error(`Error in network.js, PeerCommunication function, getLastBlock: ${err}`)
          } else {
            let status = {
              chainID: Buffer.from(this.ChainID),
              networkId: this.NETWORK_ID,
              td: Buffer.from(geneBlock.Difficulty),
              bestHash: Buffer.from(lastBlock.Hash, 'hex'),
              genesisHash: Buffer.from(geneBlock.Hash, 'hex')
            }
            debug(chalk.bold.yellowBright(`${this.ChainID} Chain Sending Local Status to Peer...`))
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
    this.sec.on('status', (status) => {
      if (status.chainID.toString() !== this.ChainID) {
        debug(`Status check failed, not same chainID => remote: ${status.chainID}, local: ${this.ChainID}`)
        return
      }
      this.logger.info(`Status once remote: ${status.chainID.toString()} | ${this.addr}, local: ${this.ChainID}`)
      debug(`${this.ChainID} Chain Running first time Status Check...`)
      this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_HEADERS, [this.ChainIDBuff, this.CHECK_BLOCK_NR])
      this.forkDrop = setTimeout(() => {
        peer.disconnect(SECDEVP2P.RLPx.DISCONNECT_REASONS.USELESS_PEER)
      }, ms('15s'))
      peer.once('close', () => clearTimeout(this.forkDrop))
    })

    this.sec.on('message', async (code, payload) => {
      if (payload[0].toString() !== this.ChainID) {
        debug(`Not ${this.ChainID} chain, received chainID is ${payload[0].toString()}`)
        return
      }
      if (code in requests.msgTypes) {
        requests.msgTypes[code] += 1
      } else {
        requests.msgTypes[code] = 1
      }
      let _payload = cloneDeep(payload[1])
      debug(chalk.bold.greenBright(`==================== On Message from ${this.ChainName} ${this.addr} ====================`))
      // debug('Requests: ')
      // debug(requests)
      // debug('Code: ' + code)
      switch (code) {
        case SECDEVP2P.SEC.MESSAGE_CODES.STATUS:
          this.STATUS(_payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK_HASHES:
          this.NEW_BLOCK_HASHES(_payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_HEADERS:
          this.GET_BLOCK_HEADERS(_payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_HEADERS:
          this.BLOCK_HEADERS(_payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_BODIES:
          this.GET_BLOCK_BODIES(_payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_BODIES:
          this.BLOCK_BODIES(_payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK:
          this.NEW_BLOCK(_payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.TX:
          this.TX(_payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.GET_NODE_DATA:
          this.GET_NODE_DATA(_payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA:
          this.NODE_DATA(_payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.GET_RECEIPTS:
          this.GET_RECEIPTS(_payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.RECEIPTS:
          this.RECEIPTS(_payload, requests)
          break

        case SECDEVP2P.SEC.MESSAGE_CODES.NODES_IP_SYNC:
          this.NODES_IP_SYNC(_payload, requests)
          break
      }
      debug(chalk.bold.greenBright(`==================== End On Message from ${this.ChainName} ${this.addr} ====================\n\n`))
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
    if (!this.forkVerified) {
      console.log('exit because fork is not verified')
      return
    }

    if (this.syncInfo.flag) {
      console.log('exit because blockchain is syncing')
      return
    }

    // new block hash received from a remote node
    let blockHash = payload.toString('hex')
    debug(`New Block Hash from Remote: ${blockHash}`)

    this.BlockChain.chain.getHashList((err, hashList) => {
      hashList = this._hashListCorrection(hashList)
      if (err) {
        this.logger.error(`Error in NEW_BLOCK_HASHES state, getHashList: ${err}`)
        console.error(`Error in NEW_BLOCK_HASHES state, getHashList: ${err}`)
      } else if (blockHash in hashList) {
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
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_HEADERS, [this.ChainIDBuff, payload])
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
        this.BlockChain.chain.getBlock(this.CHECK_BLOCK_NR - 1, (err, block) => {
          if (err) {
            this.logger.error(`Error in GET_BLOCK_HEADERS state, getBlock: ${err}`)
            console.error(`Error in GET_BLOCK_HEADERS state, getBlock: ${err}`)
          } else {
            let checkBlock = new SECBlockChain.SECTokenBlock(block)

            debug('SEC Send Message: BLOCK_HEADERS genesis block')
            this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_HEADERS, [this.ChainIDBuff, checkBlock.getHeaderBuffer()])
          }
        })
      }
    } else {
      let blockHash = payload.toString('hex')
      debug('Get Block Hash: ' + blockHash)
      this.BlockChain.chain.getBlocksWithHash(blockHash, (err, blockArray) => {
        if (err) {
          this.logger.error(`Error in GET_BLOCK_HEADERS state, getBlocksWithHash: ${err}`)
          console.error(`Error in GET_BLOCK_HEADERS state, getBlocksWithHash: ${err}`)
        } else {
          if (blockArray.length > 0) {
            let localBlock = new SECBlockChain.SECTokenBlock(blockArray[0])

            debug('SEC Send Message: BLOCK_HEADERS')
            this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_HEADERS, [this.ChainIDBuff, localBlock.getHeaderBuffer()])
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
    let blockHash = block.getHeaderHash()
    let blockHeader = JSON.parse(JSON.stringify(block.getHeader()))
    debug(`Received ${this.ChainName} block header: ${JSON.stringify(blockHeader)}`)

    if (!this.forkVerified) {
      this.BlockChain.chain.getGenesisBlock((err, geneBlock) => {
        if (err) {
          this.logger.error(`Error in BLOCK_HEADERS state, getGenesisBlock: ${err}`)
          console.error(`Error in BLOCK_HEADERS state, getGenesisBlock: ${err}`)
        } else if (blockHash === geneBlock.Hash) {
          debug(`Chain Name: ${this.ChainName}`)
          debug(`${blockHash} >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> ${geneBlock.Hash}`)
          debug(`${this.addr} verified to be on the same side of the ${this.CHECK_BLOCK_TITLE}`)
          this.forkVerified = true
          clearTimeout(this.forkDrop)
          setTimeout(() => {
            this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_NODE_DATA, [this.ChainIDBuff, []])
          }, 15000)
          this._addPeerToNDP()
          this._startSyncNodesIP()
          this._startSyncListening()
        } else {
          debug(`Chain Name: ${this.ChainName}`)
          debug(`${blockHash} >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> ${geneBlock.Hash}`)
          debug(`${this.addr} is NOT on the same side of the ${this.CHECK_BLOCK_TITLE}`)
          debug(`Expected Hash: ${geneBlock.Hash}, Remote Hash: ${blockHash}`)
        }
      })
    } else {
      if (requests.headers.indexOf(blockHash) > -1) {
        // remove it from requests.headers
        requests.headers.splice(requests.headers.indexOf(blockHash), 1)

        // verify beneficiary group id and block number
        if (!this._isValidBlock(blockHeader)) {
          return
        }

        // verify parent block hash
        this.BlockChain.chain.getBlock(blockHeader.Number - 1, (err, lastBlock) => {
          if (err) {
            // possible reason: block does not exist because received block number is larger than local chain length at least by 2
            debug(`error occurs when verify parent hash: ${err}`)
            this.BlockChain.chain.getHashList((err, hashList) => {
              if (err) {
                this.logger.error(`Error in BLOCK_HEADERS state, getHashList1: ${err}`)
                console.error(`Error in BLOCK_HEADERS state, getHashList1: ${err}`)
              } else {
                hashList = this._hashListCorrection(hashList)
                debug(`getBlock() function error condition: hash list is ${hashList}`)
                const hashListCompressBuffer = zlib.gzipSync(JSON.stringify(hashList))
                this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [this.ChainIDBuff, hashListCompressBuffer])
              }
            })
          } else {
            // case 1: parent hash successfully verified
            if (lastBlock.Hash === blockHeader.ParentHash) {
              debug(`parent hash successfully verified`)
              this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_BLOCK_BODIES, [this.ChainIDBuff, Buffer.from(blockHash, 'hex')])
              requests.bodies.push(blockHeader)
              debug(`BLOCK_HEADERS2: ${JSON.stringify(blockHeader)}`)
            } else {
              debug('parent hash verification failed')
              let localHeight = this.BlockChain.chain.getCurrentHeight()
              if (blockHeader.Number === localHeight) {
                // case 2: parent hash verification failed, local node has a forked chain and the chain has the same length as remote node chain
                debug('do nothing if two blockchains with the same length are forked')
              } else if (blockHeader.Number > localHeight) {
                // case 3: parent hash verification failed, remote node chain is longer than local chain
                debug(`remote node has more blocks than local`)
                this.BlockChain.chain.getHashList((err, hashList) => {
                  if (err) {
                    this.logger.error(`Error in BLOCK_HEADERS state, getHashList2: ${err}`)
                    console.error(`Error in BLOCK_HEADERS state, getHashList2: ${err}`)
                  } else {
                    hashList = this._hashListCorrection(hashList)
                    debug(`Parent hash verification failed, remote node has longer chain than local, hash list: ${hashList}`)
                    const hashListCompressBuffer = zlib.gzipSync(JSON.stringify(hashList))
                    this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [this.ChainIDBuff, hashListCompressBuffer])
                  }
                })
              } else {
                // case 3: parent hash verification failed, remote node chain is shorter than local chain
                debug('local db has more blocks than remote node')
                this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.GET_NODE_DATA, [this.ChainIDBuff, []])
              }
            }
          }
        })
      } else {
        debug(`Received block header hash ${blockHash} is not in requests.headers: ${requests.headers}`)
      }
    }
    debug(chalk.bold.yellow(`===== End BLOCK_HEADERS =====`))
  }

  GET_BLOCK_BODIES (payload, requests) {
    debug(chalk.bold.yellow(`===== GET_BLOCK_BODIES =====`))

    let blockHash = payload.toString('hex')
    debug('Get Block Hash: ' + blockHash)
    this.BlockChain.chain.getBlocksWithHash(blockHash, (err, blockArray) => {
      if (err) {
        this.logger.error(`Error in GET_BLOCK_BODIES state, getBlocksWithHash: ${err}`)
        console.error(`Error in GET_BLOCK_BODIES state, getBlocksWithHash: ${err}`)
      } else {
        let bodies = []
        if (blockArray.length > 0) {
          let localTokenBlock = new SECBlockChain.SECTokenBlock(blockArray[0])
          debug('Beneficiary: ' + blockArray[0].Beneficiary)
          bodies.push(SECDEVP2P._util.int2buffer(blockArray[0].Number))
          bodies.push(localTokenBlock.getBodyBuffer())
        }
        debug(`Send BLOCK_BODIES, get block with hash result: ${blockArray[0]}`)
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.BLOCK_BODIES, [this.ChainIDBuff, bodies])
      }
    })
    debug(chalk.bold.yellow(`===== End GET_BLOCK_BODIES =====`))
  }

  BLOCK_BODIES (payload, requests) {
    if (this.BlockChain.chain.deletingFlag) {
      console.log('Now deleting Blocks, return BLOCK_BODIES')
      return
    }
    debug(chalk.bold.yellow(`===== BLOCK_BODIES =====`))
    if (!this.forkVerified) return

    for (let [index, blockHeader] of requests.bodies.entries()) {
      let block = new SECBlockChain.SECTokenBlock()
      block.setHeader(blockHeader)
      debug(`BLOCK_BODIES: block in requests.bodies: ${JSON.stringify(blockHeader)}`)

      // find the corresponding block stored in requests.bodies
      if (blockHeader.Number !== SECDEVP2P._util.buffer2int(payload[0])) {
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

      let secblock = cloneDeep(new SECBlockChain.SECTokenBlock(block.getBlock()))
      let _secblock = cloneDeep(secblock.getBlock())
      debug(`block data after set body: ${JSON.stringify(secblock)}`)

      if (this.Consensus.ChainName === 'SEN') {
        this.Consensus.secReward.verifyReward(_secblock, (err, result) => {
          if (err) {
            this.logger.error(`Error in BLOCK_BODIES state, verifyReward: ${err}`)
            console.error(`Error in BLOCK_BODIES state, verifyReward: ${err}`)
          } else {
            if (result) {
              this.BlockChain.chain.putBlockToDB(_secblock, true, (err) => {
                if (err) {
                  this.logger.error(`Error in BLOCK_BODIES state, putBlockToDB: ${err}`)
                  console.error(`Error in BLOCK_BODIES state, putBlockToDB: ${err}`)
                } else {
                  this.syncInfo.newBlockLastTime = new Date().getTime()
                  debug(`Get New Block from: ${this.addr} and saved in local Blockchain, block Number: ${secblock.Number}, block Hash: ${secblock.Hash}`)
                  secblock = cloneDeep(new SECBlockChain.SECTokenBlock(_secblock))
                  this._onNewBlock(secblock)
                  if (this.ChainName === 'SEN') {
                    this.Consensus.resetPOW()
                  }
                }
              })
            } else {
              this.logger.error(`Reward value incorrect`)
              console.error(`Reward value incorrect`)
            }
          }
        })
      } else {
        this.BlockChain.chain.putBlockToDB(_secblock, true, (err) => {
          if (err) {
            this.logger.error(`Error in BLOCK_BODIES state, putBlockToDB: ${err}`)
            console.error(`Error in BLOCK_BODIES state, putBlockToDB: ${err}`)
          } else {
            this.syncInfo.newBlockLastTime = new Date().getTime()
            debug(`Get New Block from: ${this.addr} and saved in local Blockchain, block Number: ${secblock.Number}, block Hash: ${secblock.Hash}`)
            secblock = cloneDeep(new SECBlockChain.SECTokenBlock(_secblock))
            this._onNewBlock(secblock)
            if (this.ChainName === 'SEN') {
              this.Consensus.resetPOW()
            }
          }
        })
      }
    }
    debug(chalk.bold.yellow(`===== End BLOCK_BODIES =====`))
  }

  NEW_BLOCK (payload, requests) {
    debug(chalk.bold.yellow(`===== NEW_BLOCK =====`))
    if (!this.forkVerified) return
    if (this.BlockChain.chain.deletingFlag) {
      console.log('Now deleting Blocks, return New Block')
      return
    }
    console.log('syncing Finished: ' + this.syncInfo.syncingfinished)
    this.logger.info('syncing Finished: ' + this.syncInfo.syncingfinished)
    console.log('syncingFlag: ' + this.syncingFlag)
    this.logger.info('syncingFlag: ' + this.syncingFlag)
    if (!this.syncingFlag) {
      this.syncingFlag = true
      this.syncingTimer = setTimeout(() => {
        this.syncingFlag = false
      }, ms('180s'))
      let remoteHeight = SECDEVP2P._util.buffer2int(payload[0])
      let remoteAddress = payload[2].toString('hex')
      this.syncInfo.remoteheight = (this.syncInfo.remoteheight < remoteHeight ? remoteHeight : this.syncInfo.remoteheight)
      console.log(`current remote height: ${this.syncInfo.remoteheight}`)
      this.logger.info(`current remote height: ${this.syncInfo.remoteheight}`)
      // Check if the node is syncronizing blocks from other nodes
      if (this.syncInfo.flag) {
        console.log('localaddress: ' + this.syncInfo.address)
        console.log('remoteaddress: ' + remoteAddress)
        this.logger.info(this.syncInfo.address)
        this.logger.info(remoteAddress)
        if (this.syncInfo.address !== remoteAddress) return
      } else {
        this.logger.info('Flag: false and set to true')
        this.logger.info('Address: ' + this.syncInfo.address)
        this.syncInfo.flag = true
        this.syncInfo.address = remoteAddress
      }
      this.logger.info('Not return')
      console.log('Not return')
      clearTimeout(this.syncInfo.timer)
      this.syncInfo.timer = setTimeout(() => {
        this.syncingFlag = false
        this.syncInfo.flag = false
        this.syncInfo.address = null
      }, ms('180s'))
      let firstRemoteBlockNum = new SECBlockChain.SECTokenBlock(payload[1][0]).getHeader().Number
      console.time('NEW_BLOCK ' + firstRemoteBlockNum)
      debug(`Start syncronizing multiple blocks, first block's height is: ${firstRemoteBlockNum}, ${payload[1].length} blocks syncing`)
      this.logger.info(`Start syncronizing multiple blocks, first block's height is: ${firstRemoteBlockNum}, ${payload[1].length} blocks syncing`)

      // find out wether Block removed from Blockchain are needed
      if (this.BlockChain.chain.getCurrentHeight() === firstRemoteBlockNum - 1) {
        // no Block removed from blockchain needed
        this.logger.info('Normal Syncing Blockchain')
        console.log('Normal Syncing Blockchain')
        this._putBlocksToDB(payload, remoteHeight, firstRemoteBlockNum)
      } else if (this.BlockChain.chain.getCurrentHeight() > firstRemoteBlockNum - 1) {
        this.BlockChain.chain.getBlock(firstRemoteBlockNum, (err, localBlock) => {
          if (err) {
            this._resetSyncingFlags()
            this._removeBlocks(firstRemoteBlockNum - 20)
            this.logger.error(`Error in NEW_BLOCK state, get Local Block Error: ${err}`)
            console.error(`Error in NEW_BLOCK state, get Local Block Error: ${err}`)
          } else {
            let firstRemoteBlockHash = new SECBlockChain.SECTokenBlock(payload[1][0]).getBlock().Hash
            if (localBlock.Hash !== firstRemoteBlockHash) {
              this.logger.info('Remove block from blockchain')
              console.log('Remove block from blockchain')
              console.time('delBlockFromHeight ' + firstRemoteBlockNum)
              // remove all the blocks which have a larger block number than the first block to be syncronized
              this.BlockChain.chain.delBlockFromHeight(firstRemoteBlockNum, (err, txArray) => {
                console.timeEnd('delBlockFromHeight ' + firstRemoteBlockNum)
                if (err) {
                  this.logger.error(`Error in NEW_BLOCK state, delBlockFromHeight: ${err}`)
                  console.error(`Error in NEW_BLOCK state, delBlockFromHeight: ${err}`)
                }
                console.time('checkTxArray ' + firstRemoteBlockNum)
                this.BlockChain.checkTxArray(txArray, (err, _txArray) => {
                  console.timeEnd('checkTxArray ' + firstRemoteBlockNum)
                  if (err) {
                    this._resetSyncingFlags()
                    this.logger.error(`Error in NEW_BLOCK state, eachSeries else: ${err}`)
                    console.error(`Error in NEW_BLOCK state, eachSeries else: ${err}`)
                  } else {
                    _txArray.forEach((tx) => {
                      this.BlockChain.pool.addTxIntoPool(tx)
                    })
                  }
                  setTimeout(() => {
                    this._putBlocksToDB(payload, remoteHeight, firstRemoteBlockNum)
                  }, 15000)
                })
              })
            } else {
              if (this.BlockChain.chain.getCurrentHeight() === firstRemoteBlockNum && payload[1].length > 1) {
                this.logger.info('Normal Syncing Blockchain for old version')
                console.log('Normal Syncing Blockchain for old version')
                payload[1].shift()
                this._putBlocksToDB(payload, remoteHeight, firstRemoteBlockNum + 1)
              } else {
                this._resetSyncingFlags()
                this.logger.info(`first Block from remote: ${firstRemoteBlockNum}`)
                console.log(`first Block from remote: ${firstRemoteBlockNum}`)
                this.logger.info(`No fork found! Don't need Sync Blocks from this Peer ${this.addr}`)
                console.log(`No fork found! Don't need Sync Blocks from this Peer ${this.addr}`)
              }
            }
          }
        })
      } else {
        this.logger.info('Remove block from blockchain with current height')
        console.log('Remove block from blockchain with current height')
        let currentHeight = this.BlockChain.chain.getCurrentHeight()
        console.time('delBlockFromHeight ' + currentHeight)
        // remove all the blocks which have a larger block number than the first block to be syncronized
        this.BlockChain.chain.delBlockFromHeight(currentHeight, (err, txArray) => {
          console.timeEnd('delBlockFromHeight ' + currentHeight)
          if (err) {
            this.logger.error(`Error in NEW_BLOCK state, delBlockFromHeight: ${err}`)
            console.error(`Error in NEW_BLOCK state, delBlockFromHeight: ${err}`)
          }
          console.time('checkTxArray ' + firstRemoteBlockNum)
          this.BlockChain.checkTxArray(txArray, (err, _txArray) => {
            console.timeEnd('checkTxArray ' + firstRemoteBlockNum)
            if (err) {
              this._resetSyncingFlags()
              this.logger.error(`Error in NEW_BLOCK state, eachSeries else: ${err}`)
              console.error(`Error in NEW_BLOCK state, eachSeries else: ${err}`)
            } else {
              // add the removed txs into pool
              _txArray.forEach((tx) => {
                this.BlockChain.pool.addTxIntoPool(tx)
              })
              this.BlockChain.chain.getHashList((err, hashList) => {
                this._resetSyncingFlags()
                if (err) {
                  this.logger.error(`Error in NEW_BLOCK state, eachSeries getHashList: ${err}`)
                  console.error(`Error in NEW_BLOCK state, eachSeries getHashList: ${err}`)
                } else {
                  // TODO: hashList may has consistent problem
                  hashList = this._hashListCorrection(hashList)
                  console.timeEnd('NEW_BLOCK ' + firstRemoteBlockNum)
                  const hashListCompressBuffer = zlib.gzipSync(JSON.stringify(hashList))
                  this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [this.ChainIDBuff, hashListCompressBuffer])
                }
              })
            }
          })
        })
      }
    }
  }

  TX (payload, requests) {
    debug(chalk.bold.yellow(`===== TX =====`))
    if (!this.forkVerified) return

    let tokenTx = cloneDeep(new SECTransaction.SECTokenTx(payload))
    if (this._isValidTx(tokenTx)) this._onNewTx(tokenTx)

    debug(chalk.bold.yellow(`===== End TX =====`))
  }

  GET_NODE_DATA (payload, requests) {
    debug(chalk.bold.yellow(`===== GET_NODE_DATA =====`))
    this.BlockChain.chain.getHashList((err, hashList) => {
      if (err) {
        this.logger.error(`Error in GET_NODE_DATA state, getHashList: ${err}`)
        console.error(`Error in GET_NODE_DATA state, getHashList: ${err}`)
      } else {
        hashList = this._hashListCorrection(hashList)
        const hashListCompressBuffer = zlib.gzipSync(JSON.stringify(hashList))
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [this.ChainIDBuff, hashListCompressBuffer])
      }
    })
    debug(chalk.bold.yellow(`===== End GET_NODE_DATA =====`))
  }

  NODE_DATA (payload, requests) {
    if (this.BlockChain.chain.deletingFlag) {
      console.log('Now deleting Blocks, return NODE_DATA')
      return
    }
    debug(chalk.bold.yellow(`===== NODE_DATA =====`))
    let remoteHashList = []
    try {
      remoteHashList = cloneDeep(JSON.parse(zlib.unzipSync(payload)))
    } catch (err) {
      remoteHashList = cloneDeep(JSON.parse(payload.toString()))
    }
    if (remoteHashList[remoteHashList.length - 1]) {
      let remoteHeight = remoteHashList[remoteHashList.length - 1].Number
      let remoteLastHash = remoteHashList[remoteHashList.length - 1].Hash

      let localHeight = this.BlockChain.chain.getCurrentHeight()
      debug('local Height: ' + localHeight)
      debug('remote Height: ' + remoteHeight)
      debug('remote Lasthash: ' + remoteLastHash)

      this.BlockChain.chain.getHashList((err, hashList) => {
        if (err) {
          this.logger.error(`Error in NODE_DATA state, getHashList: ${err}`)
          console.error(`Error in NODE_DATA state, getHashList: ${err}`)
        } else if (localHeight > remoteHeight) {
          // Local chain is longer than remote chain
          debug('Local Token Blockchain Length longer than remote Node')
          let errPos = this._checkHashList(hashList)
          if (errPos === -2) {
            this.logger.error('Something very strange: ')
            this.logger.error(JSON.stringify(hashList))
            return
          }
          if (errPos !== -1) {
            console.error(`Local hashList invalid at: ${JSON.stringify(hashList[errPos])}`)
            console.time('delBlockFromHeight ' + errPos)
            this.BlockChain.chain.delBlockFromHeight(errPos, (err, txArray) => {
              console.timeEnd('delBlockFromHeight ' + errPos)
              if (err) {
                this.logger.error(`Error in NODE_DATA state, delBlockFromHeight: ${err}`)
                console.error(`Error in NODE_DATA state, delBlockFromHeight: ${err}`)
              }
            })
            // TODO: local hash list incomplete
          } else {
            let blockPosition = hashList.filter(block => { return block.Hash === remoteLastHash && block.Number === remoteHeight })
            if (blockPosition.length > 0) {
              // No fork found, send 'SYNC_CHUNK' blocks to remote node
              debug('No Fork found!')
              this.BlockChain.chain.getBlocksFromDB(remoteHeight + 1, remoteHeight + SYNC_CHUNK + 1, (err, newBlocks) => {
                if (err) {
                  this.logger.error(`Error in NODE_DATA state, getBlocksFromDB1: ${err}`)
                  console.error(`Error in NODE_DATA state, getBlocksFromDB1: ${err}`)
                } else {
                  let blockBuffer = newBlocks.map(_block => {
                    return new SECBlockChain.SECTokenBlock(_block).getBlockBuffer()
                  })

                  let sentMsg = [
                    SECDEVP2P._util.int2buffer(localHeight), // local chain height
                    blockBuffer,
                    Buffer.from(this.BlockChain.SECAccount.getAddress(), 'hex') // local wallet address
                  ]
                  console.log(`Send blocks from ${remoteHeight + 1} to ${remoteHeight + SYNC_CHUNK + 1}, newBlocks length: ${newBlocks.length}`)
                  this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK, [this.ChainIDBuff, sentMsg])
                }
              })
            } else {
              debug('Fork found!')
              // check remote hash list
              let _errPos = this._checkHashList(remoteHashList)
              if (errPos === -2) {
                this.logger.error('Something very strange: ')
                this.logger.error(JSON.stringify(remoteHashList))
                return
              }
              if (_errPos === -1) {
                // find fork position
                let forkPosition = 0
                for (let i = remoteHashList.length - 1; i >= 0; i--) {
                  if (remoteHashList[i] === undefined) {
                    this.logger.info('remoteHashList not consistent')
                    this.logger.info(JSON.stringify(remoteHashList))
                    console.log(remoteHashList)
                    return
                  }
                  if (hashList === undefined) {
                    this.logger.info('hashList is undefined')
                    console.log('hashList is undefined')
                    return
                  }
                  if (hashList.filter(block => (block.Hash === remoteHashList[i].Hash)).length > 0) {
                    forkPosition = remoteHashList[i].Number + 1
                    debug('Fork Position: ' + forkPosition)
                    break
                  }
                }

                // send 'SYNC_CHUNK' blocks to remote node
                this.BlockChain.chain.getBlocksFromDB(forkPosition, forkPosition + SYNC_CHUNK, (err, newBlocks) => {
                  if (err) {
                    this.logger.error(`Error in NODE_DATA state, getBlocksFromDB2: ${err}`)
                    console.error(`Error in NODE_DATA state, getBlocksFromDB2: ${err}`)
                  } else {
                    let blockBuffer = newBlocks.map(_block => {
                      return new SECBlockChain.SECTokenBlock(_block).getBlockBuffer()
                    })

                    let sentMsg = [
                      SECDEVP2P._util.int2buffer(localHeight), // local chain height
                      blockBuffer,
                      Buffer.from(this.BlockChain.SECAccount.getAddress(), 'hex') // local wallet address
                    ]
                    debug(`Send blocks from ${forkPosition} to ${forkPosition + SYNC_CHUNK}, newBlocks length: ${newBlocks.length} for fork`)
                    this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK, [this.ChainIDBuff, sentMsg])
                  }
                })
              } else {
                // if remote hash list is wrong, then force sync remote node
                this.BlockChain.chain.getBlocksFromDB(_errPos, _errPos + SYNC_CHUNK, (err, newBlocks) => {
                  if (err) {
                    this.logger.error(`Error in NODE_DATA state, getBlocksFromDB3: ${err}`)
                    console.error(`Error in NODE_DATA state, getBlocksFromDB3: ${err}`)
                  } else {
                    let blockBuffer = newBlocks.map(_block => {
                      return new SECBlockChain.SECTokenBlock(_block).getBlockBuffer()
                    })

                    let sentMsg = [
                      SECDEVP2P._util.int2buffer(localHeight), // local chain height
                      blockBuffer,
                      Buffer.from(this.BlockChain.SECAccount.getAddress(), 'hex') // local wallet address
                    ]
                    console.log(`Send blocks from ${_errPos} to ${_errPos + SYNC_CHUNK}, newBlocks length: ${newBlocks.length} for remote hash list error`)
                    this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NEW_BLOCK, [this.ChainIDBuff, sentMsg])
                  }
                })
              }
            }
          }
        } else {
          debug('remote blockchain is longer than local blockchain')
          // do nothing if remote node blockchain is longer than local blockchain
        }
        debug(chalk.bold.yellow(`===== End NODE_DATA =====`))
      }, remoteHashList[0].Number, remoteHeight)
    }
  }

  GET_RECEIPTS (payload, requests) {
    debug(chalk.bold.yellow(`===== GET_RECEIPTS =====`))
    this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.RECEIPTS, [this.ChainIDBuff, []])
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
      console.error(`Error in NODES_IP_SYNC state, catch: ${err}`)
    }
  }

  syncFromIp (ip, callback) {
    this.BlockChain.chain.getGenesisBlock((err, geneBlock) => {
      if (err) callback(err)
      else {
        this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [this.ChainIDBuff, Buffer.from(JSON.stringify([geneBlock]))])
        callback()
      }
    })
  }

  _onNewTx (tx) {
    let _tx = cloneDeep(tx)
    if (this.syncInfo.flag) {
      // Do not receive new transactions when current node is synchronising new blocks
      setTimeout(() => {
        this._onNewTx(_tx)
      }, ms('1s'))
      return
    }

    const txHashHex = _tx.getTxHash()
    if (txCache.has(txHashHex)) return
    txCache.set(txHashHex, true)

    this.BlockChain.isTokenTxExist(_tx.getTxHash(), (err, result) => {
      if (err) {
        this.logger.error(`Error in _onNewTx function: ${err}`)
        console.error(`Error in _onNewTx function: ${err}`)
      } else if (!result) {
        this.BlockChain.pool.addTxIntoPool(_tx.getTx())
      }
    })

    this.BlockChain.sendNewTokenTx(_tx, this.peer)
    this.logger.info(`New Token Tx: ${_tx.getTx().TxHash} (from ${MainUtils.getPeerAddr(this.peer)})`)
    console.log(`New Token Tx: ${_tx.getTx().TxHash} (from ${MainUtils.getPeerAddr(this.peer)})`)
  }

  _onNewBlock (newBlock) {
    let _newBlock = cloneDeep(newBlock)
    this.BlockChain.sendNewBlockHash(_newBlock, this.peer)
    debug('----------------------------------------------------------------------------------------------------------')
    this.logger.info(`New ${this.ChainName} block ${_newBlock.getBlock().Number}: ${_newBlock.getBlock().Hash} (from ${MainUtils.getPeerAddr(this.peer)})`)
    console.log(`New ${this.ChainName} block ${_newBlock.getBlock().Number}: ${_newBlock.getBlock().Hash} (from ${MainUtils.getPeerAddr(this.peer)})`)
    debug('----------------------------------------------------------------------------------------------------------')
    this.BlockChain.pool.updateByBlock(_newBlock.getBlock())
  }

  _isValidBlock (blockHeader) {
    // verify that the beneficiary is in the corresponding group
    if (this.ChainName === 'SEN') {
      let beneAddress = blockHeader.Beneficiary
      let timestamp = blockHeader.TimeStamp
      let groupId = this.Consensus.secCircle.getTimestampWorkingGroupId(timestamp)
      let BeneGroupId = this.Consensus.secCircle.getTimestampGroupId(beneAddress, timestamp)
      if (groupId !== BeneGroupId) {
        debug(`ERROR: BLOCK_HEADERS state: groupId = ${groupId}, BeneGroupId = ${BeneGroupId}`)
        return false
      }
    }

    // verify block number
    if (blockHeader.Number <= this.BlockChain.chain.getCurrentHeight()) {
      // immediately break if block height is incorrect
      debug(`Error: new block number ${blockHeader.Number} is smaller than local chain height: ${this.BlockChain.chain.getCurrentHeight()}`)
      return false
    }

    return true
  }

  _checkHashList (hashList) {
    try {
      for (let i = 1; i < hashList.length - 1; i++) {
        if (hashList[i] === undefined) {
          return i
        }
        let hash = hashList[i].Hash
        let number = hashList[i].Number
        if (hash === undefined || number === undefined || hashList[i].ParentHash !== hashList[i - 1].Hash) {
          return i
        }
      }
      return -1
    } catch (e) {
      this.logger.info(`_checkHashList error: ${JSON.stringify(e)}`)
      console.log(`_checkHashList error: ${JSON.stringify(e)}`)
      return -2
    }
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
    this.syncNodeTimer = setInterval(() => {
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
      this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODES_IP_SYNC, [this.ChainIDBuff, Buffer.from(JSON.stringify(_peers))])
    }, 120000)
  }

  _hashListCorrection (hashList) {
    let _hashList = []
    _hashList.push(hashList[0])
    for (let i = 1; i < hashList.length; i++) {
      if (hashList[i] === undefined) break
      if (hashList[i].ParentHash === hashList[i - 1].Hash) {
        _hashList.push(hashList[i])
      } else {
        break
      }
    }
    return _hashList
  }

  _startSyncListening () {
    this.syncListeningTimer = setInterval(() => {
      // if (this.forkVerified && (this.syncInfo.flag === false) && (new Date().getTime() - this.syncInfo.newBlockLastTime > 300000)) {
      if (this.forkVerified && (this.syncInfo.flag === false)) {
        // this.logger.info(`Auto Syncing mechanism`)
        // console.log(`Auto Syncing mechanism`)
        this.BlockChain.chain.getHashList((err, hashList) => {
          if (err) {
            this.logger.error(`Error Sync listening: ${err}`)
            console.error(`Error Sync listening: ${err}`)
          } else {
            const hashListCompressBuffer = zlib.gzipSync(JSON.stringify(hashList))
            this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [this.ChainIDBuff, hashListCompressBuffer])
          }
        })
      }
    }, 180000)
  }

  _removeBlocks (beginNumber) {
    this.BlockChain.chain.delBlockFromHeight(beginNumber, (err, txArray) => {
      console.timeEnd('delBlockFromHeight ' + beginNumber)
      if (err) {
        this.logger.error(`Error in NEW_BLOCK state, delBlockFromHeight: ${err}`)
        console.error(`Error in NEW_BLOCK state, delBlockFromHeight: ${err}`)
      }
      console.time('checkTxArray ' + beginNumber)
      this.BlockChain.checkTxArray(txArray, (err, _txArray) => {
        console.timeEnd('checkTxArray ' + beginNumber)
        if (err) {
          this._resetSyncingFlags()
          this.logger.error(`Error in NEW_BLOCK state, eachSeries else: ${err}`)
          console.error(`Error in NEW_BLOCK state, eachSeries else: ${err}`)
        } else {
          // add the removed txs into pool
          _txArray.forEach((tx) => {
            this.BlockChain.pool.addTxIntoPool(tx)
          })
          this.BlockChain.chain.getHashList((err, hashList) => {
            this._resetSyncingFlags()
            if (err) {
              this.logger.error(`Error in NEW_BLOCK state, eachSeries getHashList: ${err}`)
              console.error(`Error in NEW_BLOCK state, eachSeries getHashList: ${err}`)
            } else {
              // TODO: hashList may has consistent problem
              hashList = this._hashListCorrection(hashList)
              console.timeEnd('NEW_BLOCK ' + beginNumber)
              const hashListCompressBuffer = zlib.gzipSync(JSON.stringify(hashList))
              this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [this.ChainIDBuff, hashListCompressBuffer])
            }
          })
        }
      })
    })
  }

  _putBlocksToDB (payload, remoteHeight, firstRemoteBlockNum) {
    if (this.BlockChain.chain.deletingFlag) {
      console.log('Now deleting Blocks, return _putBlocksToDB')
      return
    }
    async.eachSeries(payload[1], (payload, callback) => {
      if (this.BlockChain.chain.deletingFlag) {
        console.log('Now deleting Blocks, return New Block')
        return callback(new Error('Now deleting Blocks, return put block to db'))
      }
      let newTokenBlock = new SECBlockChain.SECTokenBlock(payload)
      let block = cloneDeep(newTokenBlock.getBlock())
      this.logger.info(`Syncronizing block ${block.Number}`)
      debug(`Syncronizing block ${block.Number}`)
      console.time('putBlockToDB ' + block.Number)
      console.time('writeNewBlock ' + block.Number)
      if (this.ChainName === 'SEN') {
        this.Consensus.secReward.verifyReward(block, (err, result) => {
          if (err) {
            this.logger.error(`Error in BLOCK_BODIES state, verifyReward: ${err}`)
            console.error(`Error in BLOCK_BODIES state, verifyReward: ${err}`)
          } else {
            if (result) {
              this.BlockChain.chain.putBlockToDB(block, true, (_err) => {
                console.timeEnd('putBlockToDB ' + block.Number)
                if (_err) {
                  return callback(_err)
                } else {
                  this.syncingFlag = true
                  clearTimeout(this.syncingTimer)
                  this.syncingTimer = setTimeout(() => {
                    this.syncingFlag = false
                  }, ms('180s'))
                  this.syncInfo.newBlockLastTime = new Date().getTime()
                  this.logger.info(chalk.green(`Sync New ${this.ChainName} Block from: ${this.addr} with height ${block.Number} and saved in local Blockchain`))
                  console.log(chalk.green(`Sync New ${this.ChainName} Block from: ${this.addr} with height ${block.Number} and saved in local Blockchain`))
                  debug(`Sync New ${this.ChainName} Block from: ${this.addr} with height ${block.Number} and saved in local Blockchain`)
                  if (this.ChainName === 'SEN') {
                    this.Consensus.resetPOW()
                  }
                  this.BlockChain.pool.updateByBlock(block)
                  console.timeEnd('writeNewBlock ' + block.Number)
                  console.log()
                  callback()
                }
              })
            } else {
              this.logger.error(`Reward value incorrect`)
              console.error(`Reward value incorrect`)
              callback(new Error('Reward value incorrect'))
            }
          }
        })
      } else {
        this.BlockChain.chain.putBlockToDB(block, true, (_err) => {
          console.timeEnd('putBlockToDB ' + block.Number)
          if (_err) {
            return callback(_err)
          } else {
            this.syncingFlag = true
            clearTimeout(this.syncingTimer)
            this.syncingTimer = setTimeout(() => {
              this.syncingFlag = false
            }, ms('180s'))
            this.syncInfo.newBlockLastTime = new Date().getTime()
            this.logger.info(chalk.green(`Sync New ${this.ChainName} Block from: ${this.addr} with height ${block.Number} and saved in local Blockchain`))
            console.log(chalk.green(`Sync New ${this.ChainName} Block from: ${this.addr} with height ${block.Number} and saved in local Blockchain`))
            debug(`Sync New ${this.ChainName} Block from: ${this.addr} with height ${block.Number} and saved in local Blockchain`)
            if (this.ChainName === 'SEN') {
              this.Consensus.resetPOW()
            }
            this.BlockChain.pool.updateByBlock(block)
            console.timeEnd('writeNewBlock ' + block.Number)
            console.log()
            callback()
          }
        })
      }
    }, (err) => {
      if (err) {
        this.logger.error(`Error in NEW_BLOCK state, eachSeries: ${err}`)
        console.error(`Error in NEW_BLOCK state, eachSeries: ${err}`)
        console.log(`Error in NEW_BLOCK state, eachSeries: ${err}`)
      }
      this.syncingFlag = false
      clearTimeout(this.syncingTimer)
      this.logger.info('Current Height: ')
      this.logger.info(this.BlockChain.chain.getCurrentHeight())
      this.logger.info('Remote Height: ')
      this.logger.info(remoteHeight)
      this.logger.info('syncInfo Remote Height: ')
      this.logger.info(this.syncInfo.remoteheight)
      if (this.BlockChain.chain.getCurrentHeight() >= remoteHeight) {
        // synchronizing finished
        if (this.BlockChain.chain.getCurrentHeight() >= this.syncInfo.remoteheight) {
          console.log('Syncing finished!')
          this.logger.info('Syncing finished!')
          this.syncInfo.syncingfinished = true
        }
        this.syncInfo.flag = false
        this.syncInfo.address = null
        this.syncingFlag = false
        clearTimeout(this.syncingTimer)
        clearTimeout(this.syncInfo.timer)
      } else {
        // continue synchronizing
        this.BlockChain.chain.getHashList((err, hashList) => {
          clearTimeout(this.syncingTimer)
          this.syncingFlag = false
          if (err) {
            this.logger.error(`Error in NEW_BLOCK state, eachSeries getHashList: ${err}`)
            console.error(`Error in NEW_BLOCK state, eachSeries getHashList: ${err}`)
          } else {
            // TODO: hashList may has consistent problem
            hashList = this._hashListCorrection(hashList)
            console.timeEnd('NEW_BLOCK ' + firstRemoteBlockNum)
            const hashListCompressBuffer = zlib.gzipSync(JSON.stringify(hashList))
            this.sec.sendMessage(SECDEVP2P.SEC.MESSAGE_CODES.NODE_DATA, [this.ChainIDBuff, hashListCompressBuffer])
          }
        })
      }
    })
  }

  _resetSyncingFlags () {
    console.log('Reset Syncing Flags')
    this.logger.info('Reset Syncing Flags')
    this.syncInfo.flag = false
    this.syncInfo.address = null
    this.syncingFlag = false
    clearTimeout(this.syncingTimer)
    clearTimeout(this.syncInfo.timer)
  }
}

module.exports = NetworkEvent
