class NodesIPSync {
  constructor () {
    this.NodesTable = []
  }

  updateNodesTable (_nodes) {
    let nodes = JSON.parse(JSON.stringify(_nodes))
    for (let i = 0; i < _nodes.length; i++) {
      if (!_nodes[i]._id) {
        console.log(_nodes[i].id)
        nodes[i]._id = _nodes[i].id.toString('hex')
      }
    }
    console.log('In Nodes:')
    console.log(nodes)
    nodes.forEach(node => {
      if (this.NodesTable.map(_node => { return _node._id }).indexOf(node._id) < 0 && node._id.length === 128) {
        node.TimeStamp = new Date()
        this.NodesTable.push(node)
      } else if (node._id.length === 128) {
        this.NodesTable.filter(__node => { return __node._id === node._id })[0].TimeStamp = new Date()
      }
    })
    this._removeUeslessNodes()
  }

  _removeUeslessNodes () {
    for (let i = 0; i < this.NodesTable.length; i++) {
      let node = this.NodesTable[i]
      let age = (new Date().getTime() - node.TimeStamp) / 1000
      // remove the nodes, which 1 hours not response
      if (age > 3600) {
        this.NodesTable.splice(i--, 1)
      }
    }
  }

  getNodesTable () {
    return this.NodesTable
  }
}

module.exports = NodesIPSync
