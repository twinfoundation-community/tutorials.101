# tutorials.102

## What's included

* [Dataspace App](./dataspace-example-app/) and sharing data among Nodes exemplified through the [Consumer Client Extension](./consumer-client/).

* `twin-node.sh` script to bootstrap and administer a Node. Use `twin-node.sh --help` to see the list of available commands.

* `onboard-org.sh` script to onboard an organization on an already bootstrapped Node. It takes the organization DID plus a user name and password, then adds the organization's verification methods and blob-encryption key, creates a tenant, and creates an admin user for it:

```sh
./onboard-org.sh <organization-did> <user-name> <user-password>
```

## Getting started

You can use:

```sh
twin-node.sh <bootstrap_command> 
```

to execute the bootstrap commands specified by [the step by step bootstrapping](../../common/HOWTO-bootstrap-node.md).

For example to create a tenant:

```sh
./twin-node.sh tenant-create
```

Alternatively you can perform a bootstrap-legacy as described in [Tutorial 101](../101/README.md):

```sh
twin-node.sh bootstrap-legacy
```

## Tutorial data

[Tutorial Data Link](./tutorial-data/data.md)

## Reference of environment variables

[https://next.twindev.org/docs/pkgs/node/docs/architecture/node-env-variables](https://next.twindev.org/docs/pkgs/node/docs/architecture/node-env-variables)
