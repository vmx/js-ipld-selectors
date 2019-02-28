# IPLD Selectors (js-ipld-selectors)

> Select a subset of your DAG.


## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Contribute](#contribute)
- [License](#license)


## Install

```sh
> git clone https://github.com/vmx/js-ipld-selectors.git
> cd js-ipld-selectors
> npm install
```


## Usage

You need to have a pre-populated [IPFS Repo](https://github.com/ipfs/js-ipfs-repo/) where run your selectors on. This could e.g. be created by [dagbuilder](https://github.com/vmx/dagbuilder/):

```console
> IPFS_PATH=/tmp/yourdatarepo dagbuilder test/fixtures/chain.dag
(node:8989) ExperimentalWarning: The fs.promises API is experimental
zdpuB1QPZuGqhNAnxPpZ7xe249yJqjesJzuAbaEcptFMjGZvg 12336 {"version":1,"time":1240779257,"bits":486604799,"nonce":2454843955}
zdpuAuX2HXBAJWHSFh9xCP65mn5CW8zbDAo24bU74CwFJk1ka 12337 {"version":1,"time":1240780369,"bits":486604799,"nonce":2162399005}
zdpuAzBUxVPDT9CMM9ST9sp2z1zUTDhaQsvM8jfzdAaPG1ded 12338 {"version":1,"time":1240781067,"bits":486604799,"nonce":1250124053}
zdpuB21oZyjj6X8VLSYRSUrbMFXpRn9eQinJkSPRRuMmsD3pu 12339 {"version":1,"time":1240781584,"bits":486604799,"nonce":89242171}
zdpuB2cr95Uc3z8zDPC6U3CXvvZK4pk4wNu47UeunphPMXqou 12340 {"version":1,"time":1240781715,"bits":486604799,"nonce":23137779}
zdpuB1awRbqgXy3xDXPPPpemNWvSkrfHNVBovWaEHW4WkT5sy 12341 {"version":1,"time":1240782328,"bits":486604799,"nonce":2451985712}
zdpuAxzrSzSqtiFMGwdY7Hw3Bea7iy2TXbUvmD3VekBeftJJg 12342 {"version":1,"time":1240782745,"bits":486604799,"nonce":81517111}
zdpuAxSE44PLHNdr6q53o34X6zYJQPtfQoYxiP7egjvhBUPAb 12343 {"version":1,"time":1240783300,"bits":486604799,"nonce":65305899}
zdpuAmn39FEJK8Rdo2HDpySCKA7bQJomFKS51TyT4yau5WiHQ 12344 {"version":1,"time":1240783462,"bits":486604799,"nonce":2738723886}
zdpuAwmV7jYT8ynSL28JDdoZ1CRKv3AUbudkYqyeovcvS1aGe 12345 {"version":1,"time":1240784732,"bits":486604799,"nonce":784807199}
```


### Using it as a module

The selector engine is using an [IPFS Block Service](https://github.com/ipfs/js-ipfs-block-service) instance to get the blocks for traversal.

```javascript
const { SelectorEngine } = require('ipld-selectors')

const blockServie = …
const engine = new SelectorEngine(blockService)
const result = await engine.select(selector)

for await (const block in result) {
  console.log(block.cid.toBaseEncodedString())
}
```

### Running it from command line

You can run a selector from the command line:

```console
> IPFS_PATH=/tmp/yourdatarepo npx . test/fixtures/chain-path.json
(node:26308) ExperimentalWarning: The fs.promises API is experimental
zdpuAwmV7jYT8ynSL28JDdoZ1CRKv3AUbudkYqyeovcvS1aGe
zdpuAmn39FEJK8Rdo2HDpySCKA7bQJomFKS51TyT4yau5WiHQ
zdpuAxSE44PLHNdr6q53o34X6zYJQPtfQoYxiP7egjvhBUPAb
zdpuAxzrSzSqtiFMGwdY7Hw3Bea7iy2TXbUvmD3VekBeftJJg
zdpuB1awRbqgXy3xDXPPPpemNWvSkrfHNVBovWaEHW4WkT5sy
zdpuB2cr95Uc3z8zDPC6U3CXvvZK4pk4wNu47UeunphPMXqou
```


## API

### constructor

 - `blockService` ([`IPFS Block Service`](https://github.com/ipfs/js-ipfs-block-service), required): a Block Service to the blocks from.

### select(selector)

> Select certain blocks.

 - `selector` (`IPLD Selector`): the selector that should be used. Currently the selectors are JSON encoded. For more information, see the [IPLD Selector specification](https://github.com/ipld/specs/blob/7ba014c1b6868514eb461db3c3126136b9250bdc/selectors/selectors.md). Examples can be found in the [`test/fixtures/`](test/fixtures) directory.


## Contribute

Feel free to join in. All welcome. Open an [issue](https://github.com/vmx/js-ipld-selectors/issues)!

Small note: If editing the README, please conform to the [standard-readme](https://github.com/RichardLitt/standard-readme) specification.


## License

This project is dual-licensed under Apache 2.0 and MIT terms:

- Apache License, Version 2.0, ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
- MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)
