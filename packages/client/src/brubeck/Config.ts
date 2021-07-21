import Config, { StrictStreamrClientConfig, StreamrClientConfig } from '../Config'
import { NetworkNodeOptions } from 'streamr-network'
import { NodeRegistryOptions } from './NodeRegistry'

export type BrubeckClientConfig = StreamrClientConfig & {
    network?: Partial<NetworkNodeOptions>
    nodeRegistry?: Partial<NodeRegistryOptions>
}

export type StrictBrubeckClientConfig = StrictStreamrClientConfig & {
    network: NetworkNodeOptions
    nodeRegistry: NodeRegistryOptions
}

// TODO: Production values
const BRUBECK_CLIENT_DEFAULTS = {
    nodeRegistry: {
        contractAddress: '0xbAA81A0179015bE47Ad439566374F2Bae098686F',
        jsonRpcProvider: 'http://10.200.10.1:8546',
    },
    network: {
        trackers: [
            'ws://127.0.0.1:30301',
            'ws://127.0.0.1:30302',
            'ws://127.0.0.1:30303'
        ],
    }

}

export default function BrubeckConfig(config: BrubeckClientConfig): StrictBrubeckClientConfig {
    return {
        ...BRUBECK_CLIENT_DEFAULTS,
        ...Config(config),
    }
}
