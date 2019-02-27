'use strict'

const fs = require('fs').promises
const promisify = require('util').promisify

const CID = require('cids')
const ipldDagCbor = require('ipld-dag-cbor')
const neodoc = require('neodoc')

const utils = require('./utils.js')

const helpText = `
usage: ipld-selectors.js FILE

arguments:
    FILE  The file containing a selector (encoded as JSON)
`

// General idea for implementing a new selector
// The `visit()` method might get any IPLD data type. This means that it could
// also be an array of nodes. The return value returns the node(s) that are
// the input for the next selector )`node`) and optionally nodes that will be
// traversed later (`later`) (that's the case e.g. for the `SelectArrayAll`
// and `SelectMapAll` selectors).
class SelectPath {
  constructor (selector) {
    this.path = selector
  }

  // `node` (`IPLDNode`, required): The IPLD Node the selector is matched on
  // `engine` (`SelectorEngine`, optional): The selector engine in order to
  //   fresh blocks
  // returns an object with these keys:
  //  - `node` (CID|Node|Array.<Node>): The node(s) to follow next
  * visit (node) {
    if (this.path in node) {
      return {
        node: node[this.path]
      }
    } else {
      return null
    }
  }
}

class SelectArrayAll {
  constructor (selector) {
    if (selector !== null) {
      throw new Error('Invalid selector: value must be `null`')
    }
  }

  // `nodes` (`IPLDNode`, required): The IPLD Node the selector is matched on
  // `engine` (`SelectorEngine`, optional): The selector engine in order to
  //   fresh blocks
  // returns an object with these keys:
  //  - `node` (CID|Node): The nodes to follow next
  //  - `later` (Array.<CID>|Array.<Node>, optional): Additional nodes to
  //    follow next
  * visit (nodes) {
    if (Array.isArray(nodes) && nodes.length > 0) {
      const result = {
        node: nodes.shift()
      }
      if (nodes.length > 0) {
        result.later = nodes
      }
      return result
    } else {
      return null
    }
  }
}

class SelectArrayPosition {
  constructor (selector) {
    this.position = selector
  }

  // `nodes` (`IPLDNode`, required): The IPLD Node the selector is matched on
  // `engine` (`SelectorEngine`, optional): The selector engine in order to
  //   fresh blocks
  // returns an object with these keys:
  //  - `node` (CID|Node): The node to follow next
  * visit (nodes) {
    if (Array.isArray(nodes) && nodes[this.position] !== undefined) {
      return {
        node: nodes[this.position]
      }
    } else {
      return null
    }
  }
}

class SelectArraySlice {
  constructor (selector) {
    if ('start' in selector) {
      this.start = selector.start
    } else {
      this.start = 0
    }
    if ('end' in selector) {
      this.end = end
    }
  }

  // `nodes` (`IPLDNode`, required): The IPLD Node the selector is matched on
  // `engine` (`SelectorEngine`, optional): The selector engine in order to
  //   fresh blocks
  // returns an object with these keys:
  //  - `node` (CID|Node): The node to follow next
  * visit (nodes) {
    if (Array.isArray(nodes)) {
      const slice = nodes.slice(this.start, this.end)
      const result = {
        node: slice.shift()
      }
      if (slice.length > 0) {
        result.later = slice
      }
      return result
    } else {
      return null
    }
  }
}

class SelectRecursive {
  constructor (selector) {
    this.follow = selector.follow
    if ('depthLimit' in selector) {
      this.depthLimit = selector.depthLimit
    } else {
      this.depthLimit = null
    }
  }

  // `node` (`IPLDNode`, required): The IPLD Node the selector is matched on
  // returns an object with these keys:
  // `engine` (`SelectorEngine`, required): The selector engine in order to
  //   fresh blocks
  //  - `node` (CID|Node|Array.<Node>): The node(s) to follow next
  async * visit (node, engine) {
    return yield * engine.recursiveSelect(
      node, this.follow.slice(), this.depthLimit)
  }
}

const buildSelector = (selector) => {
  // This is here to make it easier for callers
  if (selector === undefined) {
    return null
  }

  // The root level field is the type of the selector
  const keys = Object.keys(selector)
  if (keys.length > 1) {
    throw new Error('Invalid selector: more than one field at the root')
  }

  switch (keys[0]) {
    case 'selectPath':
      return new SelectPath(selector[keys[0]])
    case 'selectArrayAll':
      return new SelectArrayAll(selector[keys[0]])
    case 'selectArrayPosition':
      return new SelectArrayPosition(selector[keys[0]])
    case 'selectArraySlice':
      return new SelectArraySlice(selector[keys[0]])
    case 'selectRecursive':
      return new SelectRecursive(selector[keys[0]])
    default:
      throw new Error(`Unknown selector: "${keys[0]}"`)
  }
}



// TODO vmx 2019-02-12: Support more than just CBOR
const deserialize = async (block) => {
  return promisify(ipldDagCbor.util.deserialize)(block.data)
}


class SelectorEngine {
  constructor(blockService) {
    // Get blocks from the Block Service
    this._getBlock = promisify(blockService.get.bind(blockService))
  }

  async * select (selector) {
    // Every selector has a single root field
    if (Object.keys(selector).length !== 1) {
      throw new Error(
        `The selector is invalid, it needs to have a single root field`
      )
    }

    const [selectorType] = Object.keys(selector)
    switch (selectorType) {
      case 'cidRootedSelector':
        const {root, selectors} = selector.cidRootedSelector
        const rootBlock = await this._getBlock(new CID(root))
        yield rootBlock
        const rootNode = await deserialize(rootBlock)
        yield * this.recursiveSelect(rootNode, selectors)
        break
      default:
        throw new Error(`Unknown selector type: "${selectorType}"`)
    }
  }

  // Returns either if the selector was fully applied or if there's no matching
  // node anymore
  async * nonRecursiveSelect (node, selectors) {
    // The stack of nodes that we still need to traverse. It's an array of
    // object with the following shape:
    //  - `selectors`: The selectors that should be applied to the nodes
    //  - `nodes`: The CIDs of the nodes that should be traversed
    const stack = []
    do {
      const selector = buildSelector(selectors.shift())
      const result = yield * selector.visit(node, this)

      // The selector didn't match the current node
      if (result === null) {
        // return the siblings that still need to get traversed
        return {
          stack
        }
      } else {
      // We have a match
        // There is sibling nodes to be traversed later
        if ('later' in result) {
         // Push the nodes on top of the stack for future traversal
         stack.push({
           nodes: result.later,
           selectors: selectors.slice()
         })
        }

        // The next node to traverse is a CID, so let's keep traversing deeper
        //if (CID.isCID(node) || CID.isCID(result.node)) {
        if (CID.isCID(result.node)) {
          // Get Node and save it as current node
          const block = await this._getBlock(result.node)

          // Error if you node is not locally available
          if (block === null) {
            throw new Error("Block doesn't exist")
          }

          // Return every block we visit
          yield block

          node = await deserialize(block)
        } else {
        // It's just a path within the current node. It might be an array
        // of nodes.
          node = result.node
        }
      }
    } while (selectors.length > 0)

    // The selector fully matched, but we might be in the middle of a node that
    // we want to traverse in sub-sequent calls. Hence return the current node
    // fragment we are currently at
    return {
      node,
      stack
    }
  }

  // Follow all nodes including siblings
  async * recursiveSelect (node, selectors, depthLimit = null) {
    // The stack of nodes that we still need to traverse. It's an array of
    // object with the following shape:
    //  - `selectors`: The selectors that should be applied to the nodes
    //  - `nodes`: The CIDs of the nodes that should be traversed
    //  - `depthLimit`: If the depthLimit reaches zero, we will stop traversing
    //    those nodes
    const stack = []
    // Keep the original selectors around in order to reset to their state
    const originalSelectors = selectors.slice()

    while (node && (depthLimit === null || depthLimit > 0)) {
      // One call to selectNonRecursive is a single recursion step
      const result = yield * this.nonRecursiveSelect(node, selectors)

      // Push the siblings on the stack of nodes that should get visited
      for (const item of result.stack) {
        // Add the current depth limit so that the recursion can be stopped
        // accordingly
        item.depthLimit = depthLimit
        stack.push(item)
      }

      // If a depth limit is given, count it down for every iteration
      if (depthLimit !== null) {
        depthLimit--
      }

      // There is a node that will be used for the next iteration. We also
      // haven't hit the recursion limit yet.
      if ('node' in result && (depthLimit === null || depthLimit > 0 )) {
        node = result.node
        // It's a new iteration, so we also need to reset the selctors
        selectors = originalSelectors.slice()
      } else {
      // No matching node found
        // There might be nodes that should get visited
        if (stack.length > 0) {
          // Prepare for the next iteration
          const siblings = stack.pop()
          node = siblings.nodes.shift()
          selectors = siblings.selectors
          depthLimit = siblings.depthLimit
          // There are still nodes left to traverse in the future, hence push
          // them back on the stack
          if (siblings.nodes.length > 0) {
            stack.push({
              nodes: siblings.nodes,
              selectors: siblings.selectors.slice(),
              depthLimit: siblings.depthLimit
            })
          }
          // Let's continue with the sibling
          continue
        } else { // Nothing else to do, we are finished with the traversal
          return null
        }
      }
    }
  }
}

// Applies a function to every value (similar to `forEach()`) and returns
// the return value of the iterator once it's finished
const asyncIteratorHelper = async (iter, step) => {
  let next
  for (next = await iter.next(); !next.done; next = await iter.next()) {
    step(next.value)
  }
  return next.value
}

const main = async (argv) => {
  const ipfsPath = process.env.IPFS_PATH
  if (ipfsPath === undefined) {
    throw Error('`IPFS_PATH` needs to be defined')
  }

  const args = neodoc.run(helpText)
  const selector = JSON.parse(await fs.readFile(args.FILE))
  const blockService = await utils.openBlockService(ipfsPath)
  const engine = new SelectorEngine(blockService)
  const result = await engine.select(selector)

  const finalValue = await asyncIteratorHelper(result, (item) => {
    console.log(item.cid.toBaseEncodedString())
  })
  if (finalValue !== undefined) {
   console.log(`The selector wasn't fully resolved:`, finalValue)
  }
}

if (require.main === module) {
  main(process.argv).catch((error) => {
    console.error(error)
  })
}

