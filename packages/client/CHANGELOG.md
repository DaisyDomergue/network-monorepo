# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Add method `subscribeAll` to subscribe to all stream partitions.
- Add method `resendAll` to resend data from all stream partitions.
- Method `updateEncryptionKey` to update stream encryption key
- The client publishes metrics to the network at regular intervals (configurable with `metrics` config option)

### Changed

- Method `getStorageNodesOf()` renamed to `getStorageNodes()`
- Method `getStoredStreamsOf()` renamed to `getStoredStreams()`
- Method `isStreamStoredInStorageNode()` renamed to `isStoredStream()`
- Methods `createOrUpdateNodeInStorageNodeRegistry()` and `removeNodeFromStorageNodeRegistry()` replaced with single method `setStorageNodeMetadata()`
- Method `stream.update()` now requires a parameter `props`
- Storage node assignment events:
  - method `registerStorageEventListeners(listener)` replaced with `on('addToStorageNode', listener)` and `on('removeFromStorageNode', listener)`
  - method `unRegisterStorageEventListeners()` replaced with `off('addToStorageNode', listener)` and `off('removeFromStorageNode', listener)`
- Resent event:
  - method `onResent(listener)` replaced with `subscription.once('resendComplete', listener)`
- Behavior changes:
  - resends support multiple storage nodes (the data is fetched from a random storage node)
- Configuration parameter `groupKeys` renamed to `encryptionKeys`
- Exported classes `GroupKey` and `GroupKeyId` renamed to `EncryptionKey` and `EncryptionKeyId`
- Subscriptions now have a default error handler in case of errors in message processing (e.g. message validation failures).
  This means that unhandled promise rejections will not occur when not setting an explicit error handler. The default error
  handler will simply log the error and continue.

### Deprecated

### Removed

- Removed all DataUnion code. New DataUnion client will be released under https://github.com/dataunions/data-unions
- Remove method `getAllStorageNodes()`, use `getStorageNodes()` without arguments instead
- Remove (non-functional) client configuration options `autoConnect` and `autoDisconnect`
- Remove method `disconnect()`, use `destroy()` instead
- Remove method `unsubscribeAll()`, use `unsubscribe()` without arguments instead
- Remove client configuration option `client.network.name`

### Fixed

- Fix stream encryption: messages weren't automatically encrypted if the local database didn't contain pre-existing encryption keys for a stream
- Fix timeout issue of method `addToStorageNode` when used with storage node cluster

### Security


## [6.0.4] - 2022-04-28

### Fixed
- Update `streamr-network` library that includes a fix to Firefox compatibility

## [6.0.3] - 2022-04-25

### Fixed
- Fix stream encryption: messages weren't automatically encrypted if the local database didn't contain pre-existing encryption keys for a stream

## [6.0.2] - 2022-03-04

### Fixed
- Fixed an issue in which method `searchStreams` would throw on invalid metadata (NET-730)

## [6.0.1] - 2022-02-24

### Fixed
- Fixed an import so that the client successfully loads in a web browser environment (NET-721)

[Unreleased]: https://github.com/streamr-dev/network-monorepo/compare/client/v6.0.4...HEAD
[6.0.4]: https://github.com/streamr-dev/network-monorepo/compare/client/v6.0.3...client/v6.0.4
[6.0.3]: https://github.com/streamr-dev/network-monorepo/compare/client/v6.0.2...client/v6.0.3
[6.0.2]: https://github.com/streamr-dev/network-monorepo/compare/client/v6.0.1...client/v6.0.2
[6.0.1]: https://github.com/streamr-dev/network-monorepo/compare/client/v6.0.0...client/v6.0.1
