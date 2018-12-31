class NodesIPSync {
  constructor () {
    this.NodesTable = []
  }

  updateNodesTable (nodes) {
    console.log('In Nodes:')
    console.log(nodes)
    nodes.forEach(node => {
      if (this.NodesTable.map(_node => { return _node.id }).indexOf(node.id) < 0 && node.id.length === 128) {
        node.TimeStamp = new Date()
        this.NodesTable.push(node)
      } else if (node.id.length === 128) {
        this.NodesTable.filter(__node => { return __node.id === node.id })[0].TimeStamp = new Date()
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
