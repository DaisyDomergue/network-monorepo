import 'reflect-metadata'
import Config, { StrictStreamrClientConfig, StreamrClientConfig } from './ConfigBase'
import defaultsDeep from 'lodash/defaultsDeep'
import cloneDeep from 'lodash/cloneDeep'
import { NetworkNodeOptions } from 'streamr-network'
import { NodeRegistryOptions } from './NodeRegistry'

export type BrubeckClientConfig = StreamrClientConfig & {
    network?: Partial<NetworkNodeOptions>
    nodeRegistry?: Partial<NodeRegistryOptions>
}

export {
    NetworkNodeOptions as NetworkNodeConfig,
    NodeRegistryOptions as NodeRegistryConfig
}

export type StrictBrubeckClientConfig = StrictStreamrClientConfig & {
    network: NetworkNodeOptions
    nodeRegistry: NodeRegistryOptions
}

const BrubeckConfigInjection = {
    Root: Symbol('Config.Root'),
    Auth: Symbol('Config.Auth'),
    Ethereum: Symbol('Config.Ethereum'),
    Network: Symbol('Config.Network'),
    Connection: Symbol('Config.Connection'),
    Subscribe: Symbol('Config.Subscribe'),
    Publish: Symbol('Config.Publish'),
    Cache: Symbol('Config.Cache'),
    NodeRegistry: Symbol('Config.NodeRegistry'),
    Encryption: Symbol('Config.Encryption'),
}

export * from './ConfigBase'

export { BrubeckConfigInjection as Config }

// TODO: Production values
const BRUBECK_CLIENT_DEFAULTS = {
    nodeRegistry: {
        contractAddress: '0xbAA81A0179015bE47Ad439566374F2Bae098686F',
        jsonRpcProvider: 'http://192.168.0.8:8546',
    },
    network: {
        trackers: [
            { id: 'tracker1', ws: 'ws://192.168.0.8:30301', http: 'http://192.168.0.8:30301' },
            { id: 'tracker2', ws: 'ws://192.168.0.8:30302', http: 'http://192.168.0.8:30301' },
            { id: 'tracker3', ws: 'ws://192.168.0.8:30303', http: 'http://192.168.0.8:30301' },
        ],
    },
}

export default function BrubeckConfig(config: BrubeckClientConfig): StrictBrubeckClientConfig {
    return cloneDeep(defaultsDeep({}, BRUBECK_CLIENT_DEFAULTS, Config(config)))
}
