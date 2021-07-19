import { BrubeckClient } from './BrubeckClient'
import { SPID, SPIDLikeObject, MessageRef, StreamMessage } from 'streamr-client-protocol'
import AbortController from 'node-abort-controller'
import MessageStream from './MessageStream'
import { StorageNode } from '../stream/StorageNode'
import { authRequest } from '../rest/authFetch'
import { pOnce, instanceId } from '../utils'
import { Context, ContextError } from '../utils/Context'
import { inspect } from '../utils/log'
import split2 from 'split2'
import Session from '../Session'
import NodeRegistry from './NodeRegistry'
import { Transform } from 'stream'

const MIN_SEQUENCE_NUMBER_VALUE = 0

type QueryDict = Record<string, string | number | boolean | null | undefined>

async function fetchStream(url: string, session: Session, opts = {}, abortController = new AbortController()) {
    const startTime = Date.now()
    const response = await authRequest(url, session, {
        signal: abortController.signal,
        ...opts,
    })

    const stream: Transform = response.body.pipe(split2((message: string) => {
        return StreamMessage.deserialize(message)
    }))
    stream.once('close', () => {
        abortController.abort()
    })
    return Object.assign(stream, {
        startTime,
    })
}

const createUrl = (baseUrl: string, endpointSuffix: string, spid: SPID, query: QueryDict = {}) => {
    const queryMap = {
        ...query,
        format: 'raw'
    }

    const queryString = new URLSearchParams(Object.entries(queryMap).filter(([_key, value]) => value != null)).toString()

    return `${baseUrl}/streams/${encodeURIComponent(spid.id)}/data/partitions/${spid.partition}/${endpointSuffix}?${queryString}`
}

export type ResendRef = MessageRef | {
    timestamp: number | Date | string,
    sequenceNumber: number,
}

export type ResendLastOptions = {
    last: number
}

export type ResendFromOptions = {
    from: ResendRef
    publisherId?: string
}

export type ResendRangeOptions = {
    from: ResendRef
    to: ResendRef
    msgChainId?: string
    publisherId?: string
}

export type ResendOptions = ResendLastOptions | ResendFromOptions | ResendRangeOptions

function isResendLast(options: any): options is ResendLastOptions {
    return options && 'last' in options && options.last != null
}

function isResendFrom(options: any): options is ResendFromOptions {
    return options && 'from' in options && !('to' in options) && options.from != null
}

function isResendRange(options: any): options is ResendRangeOptions {
    return options && 'from' in options && 'to' in options && options.to && options.from != null
}

export default class Resend implements Context {
    readonly client
    readonly id
    readonly debug

    constructor(client: BrubeckClient) {
        this.client = client
        this.id = instanceId(this)
        this.debug = this.client.debug.extend(this.id)
    }

    getRegistry = pOnce(async () => {
        return NodeRegistry.create(this.client.options.nodeRegistry)
    })

    /**
     * Call last/from/range as appropriate based on arguments
     */

    resend<T>(options: SPIDLikeObject & (ResendOptions | { resend: ResendOptions })): Promise<MessageStream<T>> {
        if ('resend' in options && options.resend) {
            return this.resend({
                ...options,
                ...options.resend,
                resend: undefined,
            })
        }

        if (isResendLast(options)) {
            const spid = SPID.from(options)
            return this.last<T>(spid, {
                count: options.last,
            })
        }

        if (isResendFrom(options)) {
            const spid = SPID.from(options)
            return this.from<T>(spid, {
                fromTimestamp: new Date(options.from.timestamp).getTime(),
                fromSequenceNumber: options.from.sequenceNumber,
                publisherId: options.publisherId,
            })
        }

        if (isResendRange(options)) {
            const spid = SPID.from(options)
            return this.range<T>(spid, {
                fromTimestamp: new Date(options.from.timestamp).getTime(),
                fromSequenceNumber: options.from.sequenceNumber,
                toTimestamp: new Date(options.to.timestamp).getTime(),
                toSequenceNumber: options.to.sequenceNumber,
                publisherId: options.publisherId,
                msgChainId: options.msgChainId,
            })
        }

        throw new ContextError(this, `can not resend without valid resend options: ${inspect(options)}`)
    }

    private async getStreamNodes(spid: SPID) {
        // this method should probably live somewhere else
        // like in the node registry or stream class
        const stream = await this.client.client.getStream(spid.id)
        const storageNodes: StorageNode[] = await stream.getStorageNodes()

        const storageNodeAddresses = new Set(storageNodes.map((n) => n.getAddress()))

        const registry = await this.getRegistry()
        const nodes = await registry.getNodes()

        return nodes.filter((node: any) => storageNodeAddresses.has(node.address))
    }

    private async fetchStream<T>(endpointSuffix: 'last' | 'range' | 'from', spid: SPID, query: QueryDict = {}) {
        const nodes = await this.getStreamNodes(spid)
        if (!nodes.length) {
            throw new ContextError(this, `no storage assigned: ${inspect(spid)}`)
        }

        // just pick first node
        // TODO: handle multiple nodes
        const url = createUrl(`${nodes[0].url}/api/v1`, endpointSuffix, spid, query)
        const messageStream = new MessageStream(this)
        messageStream.from((async function* readStream(this: Resend) {
            const dataStream = await fetchStream(url, this.client.client.session)
            try {
                yield* dataStream
            } finally {
                this.debug('destroy')
                dataStream.destroy()
            }
        }.bind(this)()))
        return messageStream as MessageStream<unknown> as MessageStream<T>
    }

    async last<T>(spid: SPID, { count }: { count: number }): Promise<MessageStream<T>> {
        return this.fetchStream('last', spid, {
            count,
        })
    }

    async from<T>(spid: SPID, {
        fromTimestamp,
        fromSequenceNumber = MIN_SEQUENCE_NUMBER_VALUE,
        publisherId
    }: {
        fromTimestamp: number,
        fromSequenceNumber?: number,
        publisherId?: string
    }): Promise<MessageStream<T>> {
        return this.fetchStream('from', spid, {
            fromTimestamp,
            fromSequenceNumber,
            publisherId,
        })
    }

    async range<T>(spid: SPID, {
        fromTimestamp,
        fromSequenceNumber = MIN_SEQUENCE_NUMBER_VALUE,
        toTimestamp,
        toSequenceNumber = MIN_SEQUENCE_NUMBER_VALUE,
        publisherId,
        msgChainId
    }: {
        fromTimestamp: number,
        fromSequenceNumber?: number,
        toTimestamp: number,
        toSequenceNumber?: number,
        publisherId?: string,
        msgChainId?: string
    }): Promise<MessageStream<T>> {
        return this.fetchStream('from', spid, {
            fromTimestamp,
            fromSequenceNumber,
            toTimestamp,
            toSequenceNumber,
            publisherId,
            msgChainId,
        })
    }

    async stop() {
        const registryTask = this.getRegistry()
        this.getRegistry.reset()
        const registry = await registryTask
        registry.stop()
    }
}