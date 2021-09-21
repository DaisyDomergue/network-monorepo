import 'reflect-metadata'
import './utils/PatchTsyringe'
import { container, DependencyContainer, inject } from 'tsyringe'

import { uuid, counterId, pOnce } from './utils'
import { Debug } from './utils/log'
import { Context } from './utils/Context'
import BrubeckConfig, { Config, StrictBrubeckClientConfig, BrubeckClientConfig } from './Config'
import { BrubeckContainer } from './Container'

import Publisher from './Publisher'
import Subscriber from './Subscriber'
import Resends from './Resends'
import ResendSubscribe from './ResendSubscribe'
import BrubeckNode from './BrubeckNode'
import Ethereum from './Ethereum'
import Session from './Session'
import { DestroySignal } from './DestroySignal'
import { StreamEndpoints } from './StreamEndpoints'
import { StreamEndpointsCached } from './StreamEndpointsCached'
import { LoginEndpoints } from './LoginEndpoints'
import DataUnions from './dataunion'
import GroupKeyStoreFactory from './encryption/GroupKeyStoreFactory'
import NodeRegistry, { register as registerNodeRegistry } from './StorageNodeRegistry'

const uid = process.pid != null ? process.pid : `${uuid().slice(-4)}${uuid().slice(0, 4)}`

/**
 * Take prototype functions from srcInstance and attach them to targetInstance while keeping them bound to srcInstance.
 */
function Plugin(targetInstance: any, srcInstance: any) {
    const descriptors = Object.entries({
        ...Object.getOwnPropertyDescriptors(srcInstance.constructor.prototype),
        ...Object.getOwnPropertyDescriptors(srcInstance)
    })
    descriptors.forEach(([name, { value }]) => {
        if (typeof value !== 'function') { return }

        if (name in targetInstance) {
            return // do nothing if already has property
        }

        // eslint-disable-next-line no-param-reassign
        targetInstance[name] = (...args: any) => {
            return srcInstance[name].call(srcInstance, ...args)
        }
    })
    return srcInstance
}

// Get property names which have a Function-typed value i.e. a method
type MethodNames<T> = {
    // undefined extends T[K] to handle optional properties
    [K in keyof T]: (
        (undefined extends T[K] ? never : T[K]) extends Function ? K : never
    )
}[keyof T]

// Pick only methods of T
type Methods<T> = Pick<T, MethodNames<T>>

// these are mixed in via Plugin function above
// use MethodNames to only grab methods
export interface StreamrClient extends Ethereum,
    Methods<StreamEndpoints>,
    Methods<Omit<Subscriber, 'subscribe'>>,
    Methods<ResendSubscribe>,
    // connect/pOnce in BrubeckNode are pOnce, we override them anyway
    Methods<Omit<BrubeckNode, 'destroy' | 'connect'>>,
    Methods<LoginEndpoints>,
    Methods<Publisher>,
    Methods<NodeRegistry>,
    Methods<DataUnions>,
    Methods<GroupKeyStoreFactory>,
    // Omit sessionTokenPromise because TS complains:
    // Type 'undefined' is not assignable to type 'keyof Session'
    // MethodNames's [K in keyof T] doesn't work if K is optional?
    Methods<Omit<Session, 'sessionTokenPromise'>>,
    Methods<Resends> {
}

class StreamrClientBase implements Context {
    static generateEthereumAccount = Ethereum.generateEthereumAccount.bind(Ethereum)

    id
    debug
    container: DependencyContainer
    options: StrictBrubeckClientConfig
    loginEndpoints: LoginEndpoints
    resendSubscriber: ResendSubscribe
    streamEndpoints: StreamEndpoints
    cached: StreamEndpointsCached
    ethereum: Ethereum
    storageNodeRegistry
    publisher: Publisher
    subscriber: Subscriber
    resends: Resends
    dataunions: DataUnions
    session: Session
    node: BrubeckNode
    groupKeyStore: GroupKeyStoreFactory
    subscribe
    protected destroySignal: DestroySignal

    constructor(
        rootContainer: DependencyContainer,
        context: Context,
        @inject(Config.Root) options: StrictBrubeckClientConfig,
        node: BrubeckNode,
        ethereum: Ethereum,
        storageNodeRegistry: NodeRegistry,
        session: Session,
        loginEndpoints: LoginEndpoints,
        streamEndpoints: StreamEndpoints,
        cached: StreamEndpointsCached,
        resends: Resends,
        publisher: Publisher,
        subscriber: Subscriber,
        resendSubscriber: ResendSubscribe,
        groupKeyStore: GroupKeyStoreFactory,
        destroySignal: DestroySignal,
        dataunions: DataUnions,
    ) { // eslint-disable-line function-paren-newline
        this.options = options!
        this.id = context.id
        this.debug = context.debug
        this.container = rootContainer
        this.loginEndpoints = loginEndpoints!
        this.streamEndpoints = streamEndpoints!
        this.ethereum = ethereum!
        this.storageNodeRegistry = storageNodeRegistry!
        this.publisher = publisher!
        this.cached = cached
        this.subscriber = subscriber!
        this.resendSubscriber = resendSubscriber!
        this.resends = resends!
        this.session = session!
        this.node = node!
        this.groupKeyStore = groupKeyStore
        this.destroySignal = destroySignal
        this.dataunions = dataunions
        Plugin(this, this.loginEndpoints)
        Plugin(this, this.streamEndpoints)
        Plugin(this, this.ethereum)
        Plugin(this, this.storageNodeRegistry)
        Plugin(this, this.publisher)
        Plugin(this, this.subscriber)
        Plugin(this, this.resends)
        Plugin(this, this.resendSubscriber)
        Plugin(this, this.session)
        Plugin(this, this.node)
        Plugin(this, this.groupKeyStore)
        Plugin(this, this.dataunions)

        // override subscribe with resendSubscriber's subscribe+resend
        this.subscribe = resendSubscriber.subscribe.bind(resendSubscriber)
    }

    connect = pOnce(async () => {
        await this.node.startNode()
        const tasks = [
            this.publisher.start(),
        ]

        await Promise.allSettled(tasks)
        await Promise.all(tasks)
    })

    /** @deprecated */
    disconnect() {
        return this.destroy()
    }

    destroy = pOnce(async () => {
        this.connect.reset() // reset connect (will error on next call)
        const tasks = [
            this.destroySignal.destroy().then(() => undefined),
            this.resends.stop(),
            this.publisher.stop(),
            this.storageNodeRegistry.stop(),
            this.subscriber.stop(),
        ]

        await Promise.allSettled(tasks)
        await Promise.all(tasks)
    })
}

/**
 * @internal
 */
export function initContainer(options: BrubeckClientConfig = {}, parentContainer = container) {
    const c = parentContainer.createChildContainer()
    const config = BrubeckConfig(options)
    const id = counterId(`StreamrClient:${uid}${config.id ? `:${config.id}` : ''}`)
    const debug = Debug(id)
    // @ts-expect-error not in types
    Object.assign(debug.inspectOpts, {
        // @ts-expect-error not in types
        ...debug.inspectOpts,
        ...config.debug.inspectOpts
    })
    debug('create')

    const rootContext = {
        id,
        debug
    }

    c.register(Context as any, {
        useValue: rootContext
    })

    c.register(BrubeckContainer, {
        useValue: c
    })

    // associate values to config tokens
    const configTokens: [symbol, object][] = [
        [Config.Root, config],
        [Config.Auth, config.auth],
        [Config.Ethereum, config],
        [Config.NodeRegistry, config.storageNodeRegistry],
        [Config.Network, config.network],
        [Config.Connection, config],
        [Config.Subscribe, config],
        [Config.Publish, config],
        [Config.Encryption, config],
        [Config.Cache, config.cache],
    ]

    configTokens.forEach(([token, useValue]) => {
        c.register(token, { useValue })
    })

    registerNodeRegistry(c)
    return {
        config,
        childContainer: c,
        rootContext,
    }
}

export class StreamrClient extends StreamrClientBase {
    container
    constructor(options: BrubeckClientConfig = {}, parentContainer = container) {
        const { childContainer: c, config } = initContainer(options, parentContainer)
        super(
            c,
            c.resolve<Context>(Context as any),
            config,
            c.resolve<BrubeckNode>(BrubeckNode),
            c.resolve<Ethereum>(Ethereum),
            c.resolve<NodeRegistry>(NodeRegistry as any),
            c.resolve<Session>(Session),
            c.resolve<LoginEndpoints>(LoginEndpoints),
            c.resolve<StreamEndpoints>(StreamEndpoints),
            c.resolve<StreamEndpointsCached>(StreamEndpointsCached),
            c.resolve<Resends>(Resends),
            c.resolve<Publisher>(Publisher),
            c.resolve<Subscriber>(Subscriber),
            c.resolve<ResendSubscribe>(ResendSubscribe),
            c.resolve<GroupKeyStoreFactory>(GroupKeyStoreFactory),
            c.resolve<DestroySignal>(DestroySignal),
            c.resolve<DataUnions>(DataUnions),
        )
        this.container = c
    }
}

export const Dependencies = {
    Context,
    BrubeckNode,
    NodeRegistry,
    Session,
    LoginEndpoints,
    StreamEndpoints,
    StreamEndpointsCached,
    Resends,
    Publisher,
    Subscriber,
    GroupKeyStoreFactory,
    DestroySignal,
    DataUnions,
}

export { ResendOptionsStrict as ResendOptions } from './Resends'
export { BrubeckClientConfig as StreamrClientOptions } from './Config'
