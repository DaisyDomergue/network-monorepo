import crypto from 'crypto'
import { writeHeapSnapshot } from 'v8'

import { wait } from 'streamr-test-utils'
import { Wallet } from 'ethers'
import { PublishRequest, StreamMessage, SIDLike, SPID } from 'streamr-client-protocol'
import LeakDetector from 'jest-leak-detector'

import { counterId, CounterId, AggregatedError, Scaffold } from '../src/utils'
import { Debug, format } from '../src/utils/log'
import { MaybeAsync } from '../src/types'
import { StreamProperties } from '../src/Stream'
import clientOptions from './integration/config'
import { BrubeckClient } from '../src/BrubeckClient'

import { startTracker, Tracker } from 'streamr-network'

import Signal from '../src/utils/Signal'
import { PublishMetadata } from '../src/Publisher'
import { Pipeline } from '../src/utils/Pipeline'

const testDebugRoot = Debug('test')
const testDebug = testDebugRoot.extend.bind(testDebugRoot)
export {
    testDebug as Debug
}

export function mockContext() {
    const id = counterId('mockContext')
    return { id, debug: testDebugRoot.extend(id) }
}

export const uid = (prefix?: string) => counterId(`p${process.pid}${prefix ? '-' + prefix : ''}`)

export function fakePrivateKey() {
    return crypto.randomBytes(32).toString('hex')
}

export function fakeAddress() {
    return crypto.randomBytes(32).toString('hex').slice(0, 40)
}

const TEST_REPEATS = (process.env.TEST_REPEATS) ? parseInt(process.env.TEST_REPEATS, 10) : 1

export function describeRepeats(msg: any, fn: any, describeFn = describe) {
    for (let k = 0; k < TEST_REPEATS; k++) {
        // eslint-disable-next-line no-loop-func
        describe(msg, () => {
            describeFn(`test repeat ${k + 1} of ${TEST_REPEATS}`, fn)
        })
    }
}

describeRepeats.skip = (msg: any, fn: any) => {
    describe.skip(`${msg} – test repeat ALL of ${TEST_REPEATS}`, fn)
}

describeRepeats.only = (msg: any, fn: any) => {
    describeRepeats(msg, fn, describe.only)
}

export async function collect(iterator: any, fn: MaybeAsync<(item: any) => void> = async () => {}) {
    const received: any[] = []
    for await (const msg of iterator) {
        received.push(msg.getParsedContent())
        await fn({
            msg, iterator, received,
        })
    }

    return received
}

export function getTestSetTimeout() {
    const addAfter = addAfterFn()
    return (callback: () => void, ms?: number) => {
        const t = setTimeout(callback, ms)
        addAfter(() => {
            clearTimeout(t)
        })
        return t
    }
}

export function addAfterFn() {
    const afterFns: any[] = []
    afterEach(async () => {
        const fns = afterFns.slice()
        afterFns.length = 0
        // @ts-expect-error
        AggregatedError.throwAllSettled(await Promise.allSettled(fns.map((fn) => fn())))
    })

    return (fn: any) => {
        afterFns.push(fn)
    }
}

export function Msg<T extends object>(opts?: T) {
    return {
        value: uid('msg'),
        ...opts,
    }
}

export type CreateMessageOpts = {
    /** index of message in total */
    index: number,
    /** batch number */
    batch: number,
    /** index of message in batch */
    batchIndex: number,
    /** total messages */
    total: number
}

export type PublishOpts = {
    testName: string,
    delay: number
    timeout: number
    /** set false to allow gc message content */
    retainMessages: boolean,
    waitForLast: boolean
    waitForLastCount: number
    waitForLastTimeout: number
    beforeEach: (m: any) => any
    afterEach: (msg: any, request: PublishRequest) => Promise<void> | void
    timestamp: number | (() => number)
    partitionKey: string
    createMessage: (opts: CreateMessageOpts) => Promise<any> | any
    batchSize: number
}

export const createMockAddress = () => '0x000000000000000000000000000' + Date.now()

export function getRandomClient() {
    const wallet = new Wallet(`0x100000000000000000000000000000000000000012300000001${Date.now()}`)
    return new BrubeckClient({
        ...clientOptions,
        auth: {
            privateKey: wallet.privateKey
        }
    })
}

export const expectInvalidAddress = (operation: () => Promise<any>) => {
    return expect(() => operation()).rejects.toThrow()
}

// eslint-disable-next-line no-undef
const getTestName = (module: NodeModule) => {
    const fileNamePattern = new RegExp('.*/(.*).test\\...')
    const groups = module.filename.match(fileNamePattern)
    return (groups !== null) ? groups[1] : module.filename
}

const randomTestRunId = process.pid != null ? process.pid : crypto.randomBytes(4).toString('hex')

// eslint-disable-next-line no-undef
export const createRelativeTestStreamId = (module: NodeModule, suffix?: string) => {
    return counterId(`/test/${randomTestRunId}/${getTestName(module)}${(suffix !== undefined) ? '-' + suffix : ''}`, '-')
}

// eslint-disable-next-line no-undef
export const createTestStream = (streamrClient: BrubeckClient, module: NodeModule, props?: Partial<StreamProperties>) => {
    return streamrClient.createStream({
        id: createRelativeTestStreamId(module),
        ...props
    })
}

/**
 * Write a heap snapshot file if WRITE_SNAPSHOTS env var is set.
 */
export function snapshot() {
    if (!process.env.WRITE_SNAPSHOTS) { return '' }
    testDebugRoot('heap snapshot >>')
    const value = writeHeapSnapshot()
    testDebugRoot('heap snapshot <<', value)
    return value
}

const testUtilsCounter = CounterId('test/utils')

export class LeaksDetector {
    leakDetectors: Map<string, LeakDetector> = new Map()
    private counter = CounterId(testUtilsCounter(this.constructor.name))

    add(name: string, obj: any) {
        if (!obj || typeof obj !== 'object') { return }
        this.leakDetectors.set(this.counter(name), new LeakDetector(obj))
    }

    addAll(id: string, obj: object, seen = new Set(), depth = 0) {
        if (!obj || typeof obj !== 'object') { return }

        if (id.includes('cachedNode-peerInfo-controlLayerVersions') || id.includes('cachedNode-peerInfo-messageLayerVersions')) {
            // temporary whitelist some leak in network code
            return
        }

        if (depth > 5) { return }

        if (seen.has(obj)) { return }
        seen.add(obj)
        this.add(id, obj)
        if (Array.isArray(obj)) {
            obj.forEach((value, key) => {
                const childId = value.id || `${id}-${key}`
                this.addAll(childId, value, seen, depth + 1)
            })
            return
        }

        Object.entries(obj).forEach(([key, value]) => {
            if (!value || typeof value !== 'object') { return }

            if (seen.has(value) || key.startsWith('_')) { return }

            // skip tsyringe containers, root parent will never be gc'ed.
            if (value.constructor && value.constructor.name === 'InternalDependencyContainer') {
                return
            }

            const childId = value.id || `${id}-${key}`
            this.addAll(childId, value, seen, depth + 1)
        })
    }

    async getLeaks(): Promise<string[]> {
        await wait(10) // wait a moment for gc to run?
        const outstanding = new Set<string>()
        const results = await Promise.all([...this.leakDetectors.entries()].map(async ([key, d]) => {
            outstanding.add(key)
            const isLeaking = await d.isLeaking()
            outstanding.delete(key)
            return isLeaking ? key : undefined
        }))
        return results.filter((key) => key != null) as string[]
    }

    async checkNoLeaks() {
        const leaks = await this.getLeaks()
        if (leaks.length) {
            throw new Error(format('Leaking %d of %d items: %o', leaks.length, this.leakDetectors.size, leaks))
        }
    }

    async checkNoLeaksFor(id: string) {
        const leaks = await this.getLeaks()
        if (leaks.includes(id)) {
            throw new Error(format('Leaking %d of %d items, including id %s: %o', leaks.length, this.leakDetectors.size, id, leaks))
        }
    }

    clear() {
        this.leakDetectors.clear()
    }
}

type PublishManyOpts = Partial<{
    delay: number,
    timestamp: number | (() => number)
    sequenceNumber: number | (() => number)
    createMessage: (content: any) => any
}>

export async function* publishManyGenerator(
    total: number = 5,
    opts: PublishManyOpts = {}
): AsyncGenerator<PublishMetadata<any>> {
    const { delay = 10, sequenceNumber, timestamp, createMessage = Msg } = opts
    const batchId = counterId('publishMany')
    for (let i = 0; i < total; i++) {
        yield {
            timestamp: typeof timestamp === 'function' ? timestamp() : timestamp,
            sequenceNumber: typeof sequenceNumber === 'function' ? sequenceNumber() : sequenceNumber,
            content: createMessage({
                batchId,
                value: `${i + 1} of ${total}`
            })
        }

        if (delay) {
            // eslint-disable-next-line no-await-in-loop
            await wait(delay)
        }
    }
}

type PublishTestMessageOptions = PublishManyOpts & {
    waitForLast?: boolean
    waitForLastCount?: number
    waitForLastTimeout?: number,
    retainMessages?: boolean
    onSourcePipeline?: Signal<Pipeline<PublishMetadata<any>>>
    onPublishPipeline?: Signal<Pipeline<StreamMessage>>
    afterEach?: (msg: StreamMessage) => Promise<void> | void
}

export function publishTestMessagesGenerator(client: BrubeckClient, stream: SIDLike, maxMessages: number = 5, opts: PublishTestMessageOptions = {}) {
    const sid = SPID.parse(stream)
    const source = new Pipeline(publishManyGenerator(maxMessages, opts))
    if (opts.onSourcePipeline) {
        opts.onSourcePipeline.trigger(source)
    }
    const pipeline = new Pipeline<StreamMessage>(client.publisher.publishFromMetadata(sid, source))
    if (opts.afterEach) {
        pipeline.forEach(opts.afterEach)
    }
    return pipeline

}

export function getPublishTestStreamMessages(client: BrubeckClient, stream: SIDLike, defaultOpts: PublishTestMessageOptions = {}) {
    const sid = SPID.parse(stream)
    return async (maxMessages: number = 5, opts: PublishTestMessageOptions = {}) => {
        const {
            waitForLast,
            waitForLastCount,
            waitForLastTimeout,
            retainMessages = true,
            ...options
        } = {
            ...defaultOpts,
            ...opts,
        }
        const publishStream = publishTestMessagesGenerator(client, sid, maxMessages, options)
        if (opts.onPublishPipeline) {
            opts.onPublishPipeline.trigger(publishStream)
        }
        const streamMessages = []
        let count = 0
        for await (const streamMessage of publishStream) {
            count += 1
            if (!retainMessages) {
                streamMessages.length = 0 // only keep last message
            }
            streamMessages.push(streamMessage)
            if (count === maxMessages) {
                break
            }
        }
        streamMessages.forEach((s) => s.getParsedContent())
        if (!waitForLast) {
            return streamMessages
        }

        await getWaitForStorage(client, {
            count: waitForLastCount,
            timeout: waitForLastTimeout,
        })(streamMessages[streamMessages.length - 1])
        return streamMessages
    }
}

export function getPublishTestMessages(client: BrubeckClient, stream: SIDLike, defaultOpts: PublishTestMessageOptions = {}) {
    const sid = SPID.parse(stream)
    const publishTestStreamMessages = getPublishTestStreamMessages(client, sid, defaultOpts)
    return async (maxMessages: number = 5, opts: PublishTestMessageOptions = {}) => {
        const streamMessages = await publishTestStreamMessages(maxMessages, opts)
        return streamMessages.map((s) => s.getParsedContent())
    }
}

export function getWaitForStorage(client: BrubeckClient, defaultOpts = {}) {
    return async (lastPublished: StreamMessage, opts = {}) => {
        return client.publisher.waitForStorage(lastPublished, {
            ...defaultOpts,
            ...opts,
        })
    }
}

function initTracker() {
    const trackerPort = 30304 + (process.pid % 1000)
    let counter = 0
    let tracker: Tracker
    const update = Scaffold([
        async () => {
            tracker = await startTracker({
                host: '127.0.0.1',
                port: trackerPort,
                id: `tracker${trackerPort}`
            })

            return async () => {
                await tracker.stop()
            }
        }
    ], () => counter > 0)

    return {
        trackerPort,
        async up() {
            counter += 1
            return update()
        },
        async down() {
            counter = Math.max(0, counter - 1)
            return update()
        }
    }
}

export function useTracker() {
    const { up, down, trackerPort } = initTracker()
    beforeEach(up)
    afterEach(down)
    return trackerPort
}
