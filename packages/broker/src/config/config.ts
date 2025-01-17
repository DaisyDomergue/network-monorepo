import { StreamrClientConfig } from 'streamr-client'
import { EthereumAddress, SmartContractRecord } from 'streamr-client-protocol'
import path from 'path'
import * as os from 'os'

export interface NetworkSmartContract {
    contractAddress: EthereumAddress
    jsonRpcProvider: string
}

export type TrackerRegistryItem = SmartContractRecord

export interface HttpServerConfig {
    port: number,
    privateKeyFileName: string | null,
    certFileName: string | null
}

export type ApiAuthenticationConfig = { keys: string[] } | null

export interface Config {
    $schema: string,
    client: StreamrClientConfig
    httpServer: HttpServerConfig
    plugins: Record<string,any>
    apiAuthentication: ApiAuthenticationConfig
}

export const getDefaultFile = (): string => {
    const relativePath = '.streamr/config/default.json'
    return path.join(os.homedir(), relativePath)
}

export const getLegacyDefaultFile = (): string => {
    const relativePath = '/.streamr/broker-config.json'
    return path.join(os.homedir(), relativePath)
}
