How to add new tests
====================

In order to add new tests, you won't need to edit any files, you can just add new files into this directory, and they will be picked up automatically. In order to make this work, those files need to follow certain conventions.

Each test consists of three files:

 - The input data
 - The selector
 - The result


Input data
----------

For running tests, we need to have some data stored locally. This data comes from a file with the extension `dag`. It is process by [dagbuilder](https://github.com/vmx/dagbuilder) and hence needs to conform to the [dagbuilder file format](https://github.com/vmx/dagbuilder#the-file-format).

The filename *must not* contain any dashes. Easiest is if you only use alphanumeric characters as a filename.


The selector
-----------

Selectors are currently encoded as JSON. The schema and examples can be found in the [IPLD Selector specification](https://github.com/ipld/specs/blob/7ba014c1b6868514eb461db3c3126136b9250bdc/selectors/selectors.md).

The filename for a selector needs to start with the filename of the input data file it is run on. You can then append anything you like separated by a dash. This way you can have several selectors for a single data set. The file extension needs to be `json`.

### Example

If your input data is stored in a file called `mydata.dag`, your selector might be named:

 - mydata-myselector.json
 - mydata-something-cool.json
 - mydata-whatever-you-like.json


The result
----------

To check whether the selector returned what you would expect, you need to supply a file which contains the CIDs of the blocks that should be returned. The file contents needs to conform to the following rules: there's one base-encoded CID per line, empty lines are allowed.

The filename starts with the filename of the selector, it has `result` appended separated with a dash. The file extension is `txt`.

### Example

For the selectors mentioned in [the selector section examples](#the-selector) the result files would be:

 - mydata-myselector-result.txt
 - mydata-something-cool-result.txt
 - mydata-whatever-you-like-result.txt
