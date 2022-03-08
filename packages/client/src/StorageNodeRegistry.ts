import { Contract } from '@ethersproject/contracts'
import { Provider } from '@ethersproject/providers'
import debug from 'debug'
import type { NodeRegistry as NodeRegistryContract } from './ethereumArtifacts/NodeRegistry'
import type { StreamStorageRegistry as StreamStorageRegistryContract } from './ethereumArtifacts/StreamStorageRegistry'
import NodeRegistryArtifact from './ethereumArtifacts/NodeRegistryAbi.json'
import StreamStorageRegistryArtifact from './ethereumArtifacts/StreamStorageRegistry.json'
import { StreamQueryResult } from './StreamRegistry'
import { scoped, Lifecycle, inject, DependencyContainer } from 'tsyringe'
import { BrubeckContainer } from './Container'
import { ConfigInjectionToken, StrictStreamrClientConfig } from './Config'
import { Stream, StreamProperties } from './Stream'
import Ethereum from './Ethereum'
import { NotFoundError } from './authFetch'
import { until } from './utils'
import { EthereumAddress, StreamID, toStreamID } from 'streamr-client-protocol'
import { StreamIDBuilder } from './StreamIDBuilder'
import { waitForTx, withErrorHandlingAndLogging } from './utils/contract'
import { SynchronizedGraphQLClient, createWriteContract } from './utils/SynchronizedGraphQLClient'

const log = debug('StreamrClient:StorageNodeRegistry')

export type StorageNodeAssignmentEvent = {
    streamId: string,
    nodeAddress: EthereumAddress,
    type: 'added' | 'removed'
    blockNumber: number
}

type NodeQueryResult = {
    id: string,
    metadata: string,
    lastseen: string,
}

type StoredStreamQueryResult = {
    stream: {
        id: string,
        metadata: string,
        storageNodes: NodeQueryResult[],
    } | null,
}

type AllNodesQueryResult = {
    nodes: NodeQueryResult[],
}
type SingleNodeQueryResult = {
    node: NodeQueryResult,
}

type StorageNodeQueryResult = {
    node: {
        id: string,
        metadata: string,
        lastSeen: string,
        storedStreams: StreamQueryResult[]
    }
    _meta: {
        block: {
            number: number
        }
    }
}
@scoped(Lifecycle.ContainerScoped)
export class StorageNodeRegistry {

    private clientConfig: StrictStreamrClientConfig
    private chainProvider: Provider
    private streamStorageRegistryContractReadonly: StreamStorageRegistryContract
    private nodeRegistryContract?: NodeRegistryContract
    private streamStorageRegistryContract?: StreamStorageRegistryContract

    constructor(
        @inject(BrubeckContainer) private container: DependencyContainer,
        @inject(Ethereum) private ethereum: Ethereum,
        @inject(StreamIDBuilder) private streamIdBuilder: StreamIDBuilder,
        @inject(SynchronizedGraphQLClient) private graphQLClient: SynchronizedGraphQLClient,
        @inject(ConfigInjectionToken.Root) clientConfig: StrictStreamrClientConfig
    ) {
        this.clientConfig = clientConfig
        this.chainProvider = this.ethereum.getStreamRegistryChainProvider()
        this.streamStorageRegistryContractReadonly = withErrorHandlingAndLogging(
            new Contract(this.clientConfig.streamStorageRegistryChainAddress, StreamStorageRegistryArtifact, this.chainProvider),
            'streamStorageRegistry'
        ) as StreamStorageRegistryContract
    }

    // --------------------------------------------------------------------------------------------
    // Send transactions to the StreamRegistry or StreamStorageRegistry contract
    // --------------------------------------------------------------------------------------------

    private async connectToNodeRegistryContract() {
        if (!this.nodeRegistryContract) {
            const chainSigner = await this.ethereum.getStreamRegistryChainSigner()
            this.nodeRegistryContract = createWriteContract<NodeRegistryContract>(
                this.clientConfig.storageNodeRegistryChainAddress,
                NodeRegistryArtifact,
                chainSigner,
                'storageNodeRegistry',
                this.graphQLClient
            )
            this.streamStorageRegistryContract = createWriteContract<StreamStorageRegistryContract>(
                this.clientConfig.streamStorageRegistryChainAddress,
                StreamStorageRegistryArtifact,
                chainSigner,
                'streamStorageRegistry',
                this.graphQLClient
            )
        }
    }

    async createOrUpdateNodeInStorageNodeRegistry(nodeMetadata: string): Promise<void> {
        log('createOrUpdateNodeInStorageNodeRegistry %s -> %s', nodeMetadata)
        await this.connectToNodeRegistryContract()
        const ethersOverrides = this.ethereum.getStreamRegistryOverrides()
        await waitForTx(this.nodeRegistryContract!.createOrUpdateNodeSelf(nodeMetadata, ethersOverrides))

        const nodeAddress = await this.ethereum.getAddress()
        await until(async () => {
            try {
                const url = await this.getStorageNodeUrl(nodeAddress)
                return nodeMetadata.includes(url)
            } catch (err) {
                return false
            }
        },
        // eslint-disable-next-line no-underscore-dangle
        this.clientConfig._timeouts.theGraph.timeout,
        // eslint-disable-next-line no-underscore-dangle
        this.clientConfig._timeouts.theGraph.retryInterval,
        () => `Failed to create/update node ${nodeAddress}, timed out querying fact from theGraph`)
    }

    async removeNodeFromStorageNodeRegistry(): Promise<void> {
        log('removeNodeFromStorageNodeRegistry called')
        await this.connectToNodeRegistryContract()
        const ethersOverrides = this.ethereum.getStreamRegistryOverrides()
        await waitForTx(this.nodeRegistryContract!.removeNodeSelf(ethersOverrides))
    }

    async addStreamToStorageNode(streamIdOrPath: string, nodeAddress: EthereumAddress): Promise<void> {
        const streamId = await this.streamIdBuilder.toStreamID(streamIdOrPath)
        log('Adding stream %s to node %s', streamId, nodeAddress)
        await this.connectToNodeRegistryContract()
        const ethersOverrides = this.ethereum.getStreamRegistryOverrides()
        await waitForTx(this.streamStorageRegistryContract!.addStorageNode(streamId, nodeAddress, ethersOverrides))
    }

    async removeStreamFromStorageNode(streamIdOrPath: string, nodeAddress: EthereumAddress): Promise<void> {
        const streamId = await this.streamIdBuilder.toStreamID(streamIdOrPath)
        log('Removing stream %s from node %s', streamId, nodeAddress)
        await this.connectToNodeRegistryContract()
        const ethersOverrides = this.ethereum.getStreamRegistryOverrides()
        await waitForTx(this.streamStorageRegistryContract!.removeStorageNode(streamId, nodeAddress, ethersOverrides))
    }

    // --------------------------------------------------------------------------------------------
    // GraphQL queries
    // --------------------------------------------------------------------------------------------

    /** @internal */
    async getStorageNodeUrl(nodeAddress: EthereumAddress): Promise<string> {
        log('getnode %s ', nodeAddress)
        const res = await this.graphQLClient.sendQuery(StorageNodeRegistry.buildGetNodeQuery(nodeAddress.toLowerCase())) as SingleNodeQueryResult
        if (res.node === null) {
            throw new NotFoundError('Node not found, id: ' + nodeAddress)
        }
        const metadata = JSON.parse(res.node.metadata)
        return metadata.http
    }

    async isStreamStoredInStorageNode(streamIdOrPath: string, nodeAddress: EthereumAddress): Promise<boolean> {
        const streamId = await this.streamIdBuilder.toStreamID(streamIdOrPath)
        log('Checking if stream %s is stored in storage node %s', streamId, nodeAddress)
        return this.streamStorageRegistryContractReadonly.isStorageNodeOf(streamId, nodeAddress.toLowerCase())
    }

    async getStorageNodesOf(streamIdOrPath: string): Promise<EthereumAddress[]> {
        const streamId = await this.streamIdBuilder.toStreamID(streamIdOrPath)
        log('Getting storage nodes of stream %s', streamId)
        const res = await this.graphQLClient.sendQuery(StorageNodeRegistry.buildStoredStreamQuery(streamId)) as StoredStreamQueryResult
        if (res.stream === null) {
            return []
        }
        return res.stream.storageNodes.map((node) => node.id)
    }

    async getStoredStreamsOf(nodeAddress: EthereumAddress): Promise<{ streams: Stream[], blockNumber: number }> {
        log('Getting stored streams of node %s', nodeAddress)
        const res = await this.graphQLClient.sendQuery(StorageNodeRegistry.buildStorageNodeQuery(nodeAddress.toLowerCase())) as StorageNodeQueryResult
        const streams = res.node.storedStreams.map((stream) => {
            const props: StreamProperties = Stream.parsePropertiesFromMetadata(stream.metadata)
            return new Stream({ ...props, id: toStreamID(stream.id) }, this.container) // toStreamID() not strictly necessary
        })
        return {
            streams,
            // eslint-disable-next-line no-underscore-dangle
            blockNumber: res._meta.block.number
        }
    }

    async getAllStorageNodes(): Promise<EthereumAddress[]> {
        log('Getting all storage nodes')
        const res = await this.graphQLClient.sendQuery(StorageNodeRegistry.buildAllNodesQuery()) as AllNodesQueryResult
        return res.nodes.map((node) => node.id)
    }

    async registerStorageEventListener(callback: (event: StorageNodeAssignmentEvent) => any) {
        this.streamStorageRegistryContractReadonly.on('Added', (streamId: string, nodeAddress: EthereumAddress, extra: any) => {
            callback({ streamId, nodeAddress, type: 'added', blockNumber: extra.blockNumber })
        })
        this.streamStorageRegistryContractReadonly.on('Removed', (streamId: string, nodeAddress: EthereumAddress, extra: any) => {
            callback({ streamId, nodeAddress, type: 'removed', blockNumber: extra.blockNumber })
        })
    }

    async unregisterStorageEventListeners() {
        this.streamStorageRegistryContractReadonly.removeAllListeners()
    }

    async stop() {
        if (this.nodeRegistryContract) {
            this.nodeRegistryContract.removeAllListeners()
            this.nodeRegistryContract.provider.removeAllListeners()
        }
    }

    // --------------------------------------------------------------------------------------------
    // GraphQL queries
    // --------------------------------------------------------------------------------------------

    private static buildAllNodesQuery(): string {
        const query = `{
            nodes {
                id,
                metadata,
                lastSeen
            }
        }`
        return JSON.stringify({ query })
    }

    private static buildGetNodeQuery(nodeAddress: EthereumAddress): string {
        const query = `{
            node (id: "${nodeAddress}") {
                id,
                metadata,
                lastSeen
            }
        }`
        return JSON.stringify({ query })
    }

    private static buildStoredStreamQuery(streamId: StreamID): string {
        const query = `{
            stream (id: "${streamId}") {
                id,
                metadata,
                storageNodes {
                    id,
                    metadata,
                    lastSeen,
                }
            }
        }`
        return JSON.stringify({ query })
    }

    private static buildStorageNodeQuery(nodeAddress: EthereumAddress): string {
        const query = `{
            node (id: "${nodeAddress}") {
                id,
                metadata,
                lastSeen,
                storedStreams (first:1000) {
                    id,
                    metadata,
                }
            }
            _meta {
                block {
                    number
                }
            }
        }`
        return JSON.stringify({ query })
    }
}

