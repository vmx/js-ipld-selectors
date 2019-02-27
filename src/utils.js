'use strict'

const promisify = require('util').promisify

const IpfsBlockService = require('ipfs-block-service')
const IpfsRepo = require('ipfs-repo')

const openBlockService = promisify((ipfsRepoPath, callback) => {
  const repo = new IpfsRepo(ipfsRepoPath)
  repo.open((err) => {
    if (err) {
      callback(err)
    }
    const blockService = new IpfsBlockService(repo)
    callback(null, blockService)
  })
})

const closeBlockService = async (blockService) => {
  await promisify(blockService._repo.close.bind(blockService._repo))()
}

module.exports = {
  closeBlockService,
  openBlockService
}
