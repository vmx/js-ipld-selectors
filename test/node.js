/* eslint-env mocha */
'use strict'

const fs = require('fs')
const os = require('os')

const chai = require('chai')
const dagbuilder = require('dagbuilder')
const dirtyChai = require('dirty-chai')
const hat = require('hat')
const loadFixture = require('aegir/fixtures')

const { SelectorEngine } = require('../src/index')
const utils = require('../src/utils')

const expect = chai.expect
chai.use(dirtyChai)

const FIXTURES_DIR = 'test/fixtures'

const drainGenerator = async (generator) => {
  const result = []
  for await (const item of generator) {
    result.push(item)
  }
  return result
}

describe('fixtures for', () => {
  const selectorFiles = fs.readdirSync(FIXTURES_DIR).filter(
    (file) => file.endsWith('.json'))

  // `testConfig` is on object where the keys are the category (which is the
  // name of the `*.dag` files) and the value is an array of selector files
  // (which are the `*.json` files)
  const testConfig = {}
  for (const filename of selectorFiles) {
    const [root] = filename.split('-', 1)
    const [basename] = filename.split('.', 1)
    if (root in testConfig) {
      testConfig[root].push(basename)
    } else {
      testConfig[root] = [basename]
    }
  }

  Object.entries(testConfig).forEach(([category, basenames]) => {
    describe(category, () => {
      const hathat = hat()
      let ipfsPath = `${os.tmpdir()}/test-selectors-${hathat}/${category}`

      before(async () => {
        console.log(`Loading DAG with ${category}.dag into ${ipfsPath}`)
        const result = dagbuilder(
          ipfsPath, `${FIXTURES_DIR}/${category}.dag`, { includeId: true })
        await drainGenerator(result)
      })

      basenames.forEach((basename) => {
        it(`should pass the selector defined in ${basename}.json`, async () => {
          const selectorDescription = loadFixture(
            `${FIXTURES_DIR}/${basename}.json`)

          const blockService = await utils.openBlockService(ipfsPath)
          const engine = new SelectorEngine(blockService)
          const result = await engine.select(
           JSON.parse(selectorDescription.toString()))
          const resultArray = await drainGenerator(result)
          await utils.closeBlockService(blockService)
          const resultCids = resultArray.map((block) => {
            return block.cid.toBaseEncodedString()
          })

          const expectedDescription = loadFixture(
            `${FIXTURES_DIR}/${basename}-result.txt`)
          // The results are stored in a file where every line contains the CID
          // of the block that should be returned. Skip empty lines.
          const expected = expectedDescription.toString().split(/\r?\n/)
            .filter((line) => line.length > 0)
          expect(resultCids).to.deep.equal(expected)
        })
      })
    })
  })
})
